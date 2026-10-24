"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  EDITOR_BOX,
  EDITOR_TEXT,
  editorMinHeight,
  editorPadding,
} from "@/components/forum/composer-box";
import {
  type ComposerRequest,
  insertAtCaret,
  onComposerRequest,
  requestOnComposer,
  takePastedFiles,
  withoutAttachTag,
} from "@/components/forum/composer-insert";
import { submitOnShortcut } from "@/components/forum/composer-submit";
import type { Editor, EditorProps } from "@/components/forum/editor";
import type { Toolbar } from "@/components/forum/editor-toolbar";
import { quoteInbox } from "@/components/forum/lazy-quotes";
import {
  type ToolbarAction,
  ToolbarContext,
  type ToolbarMemory,
  type ToolbarTarget,
} from "@/components/forum/toolbar-context";
import { cn } from "@/lib/utils";
import { whenIdle } from "@/lib/when-idle";

type Field = Pick<
  HTMLTextAreaElement,
  "value" | "selectionStart" | "selectionEnd"
>;

// What the editor takes over from the box it replaces: the text, whether it takes the focus, the
// caret or selection of the box in `text` (once the box has been written in), and the control of
// the bar that had the focus, which the editor's bar gives it back. A press on the bar that waits
// for the editor puts the member in the text, at the box's caret or at the end.
export function handOver({
  field,
  entered,
  inField,
  control,
  pressed,
}: {
  field: Field | null;
  // The box has had the focus.
  entered: boolean;
  // It has it now.
  inField: boolean;
  control: string | null;
  pressed: number;
}) {
  const focused = inField || pressed > 0;
  return {
    text: field?.value ?? "",
    focused,
    selection:
      entered && field
        ? { start: field.selectionStart, end: field.selectionEnd }
        : undefined,
    control: focused ? null : control,
  };
}

// What the bar of the box acts on until the editor is in: a press asks for the editor at once and
// is kept, in order, for the editor to apply (`pressed`). Nothing is on where the caret is.
export function keptPresses(
  load: () => void,
  form: () => HTMLFormElement | null,
) {
  const pressed: ToolbarAction[] = [];
  const target: ToolbarTarget = {
    ready: false,
    run: (action) => {
      pressed.push(action);
      load();
    },
    watch: () => () => {},
    form,
  };
  return { target, pressed };
}

type Loaded = ReturnType<typeof handOver> & { Editor: typeof Editor };

// The editor's box, with its formatting bar, over a plain field that the editor takes the place
// of once the page is idle, or at once when the member goes to write in it or presses the bar.
// The editor's code is no part of the page's first load. The field is a field of the form like
// the editor is: what is typed while the editor is on its way is handed to it, with the caret,
// and a form sent before it arrives (or without JavaScript) carries the text all the same. The
// bar is the editor's own (`Toolbar`); its presses wait for the editor, which applies them, and the
// editor's bar opens with the strip, the emoji picker and the focus this one had, so nothing
// changes on the screen when the editor comes in. `line`: the one-line box of a line composer, a
// plain field until it is entered (as XenForo's "Write a comment…"), then the bar while the editor
// comes.
//
// The bar's code is part of the first load only where the caller hands it over (`bar`): the boxes
// that are in view when the page is (a reply form, an edit page). Elsewhere (a box in a dialog,
// an inline edit, a line composer, on pages such as the feed that hold many of them) it is
// fetched when the box is drawn or entered, and its band holds its room until it is there.
export function LazyEditor({
  name,
  placeholder,
  defaultValue,
  compact = true,
  minHeight = editorMinHeight(compact),
  findMembers,
  insertEvent,
  onChange,
  className,
  line = false,
  bar,
}: {
  name: string;
  placeholder: string;
  // The text it opens with, to edit something written before.
  defaultValue?: string;
  // False for the roomy editor of a page's own reply form: more padding.
  compact?: boolean;
  // One line unless the composer gives the text more room.
  minHeight?: number;
  findMembers?: EditorProps["findMembers"];
  // The name of a window event whose detail is BB code to add at the end (the quote button of a
  // post). The plain field takes it until the editor does.
  insertEvent?: string;
  // The text as it is written, in the plain field and in the editor alike.
  onChange?: (text: string) => void;
  className?: string;
  line?: boolean;
  bar?: typeof Toolbar;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const entered = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>();
  const changed = useRef(onChange);
  changed.current = onChange;
  const memory = useRef<ToolbarMemory>({
    strip: null,
    picker: null,
    code: null,
    focus: null,
  });

  // The presses on the bar while the editor is on its way, which ask for it (`load`, below).
  const loadNow = useRef(() => {});
  const [kept] = useState(() =>
    keptPresses(
      () => loadNow.current(),
      () => field.current?.form ?? null,
    ),
  );
  const toolbar = useMemo(
    () => ({ target: kept.target, memory: memory.current }),
    [kept],
  );

  const load = useCallback(() => {
    if (asked.current) return;
    asked.current = true;
    setWaiting(true);
    import("@/components/forum/editor").then(
      // The text is read and the editor put in its place in one go: a key pressed in between
      // would be typed into a box that is about to go.
      ({ Editor }) =>
        flushSync(() => {
          const active = document.activeElement;
          const control =
            active instanceof HTMLElement && box.current?.contains(active)
              ? (active.dataset.control ?? null)
              : null;
          const taken = handOver({
            field: field.current,
            entered: entered.current,
            inField: active === field.current,
            control,
            pressed: kept.pressed.length,
          });
          memory.current.focus = taken.control;
          setLoaded({ ...taken, Editor });
        }),
      // The box keeps working as it is, and asks again the next time it is entered or pressed.
      () => {
        asked.current = false;
      },
    );
  }, [kept]);
  loadNow.current = load;

  // The editor comes once the page is idle, before anyone needs it; the one-line box of a line
  // composer asks for it only when it is entered.
  useEffect(() => {
    if (line) return;
    return whenIdle(load);
  }, [line, load]);
  // The bar, where the caller did not hand it over: fetched with the box, or with its entering.
  const [fetched, setFetched] = useState<typeof Toolbar>();
  const Bar = bar ?? fetched;
  const barShown = !line || waiting;
  useEffect(() => {
    if (Bar || !barShown) return;
    let current = true;
    import("@/components/forum/editor-toolbar").then(
      (module) => current && setFetched(() => module.Toolbar),
      // The band stays; the editor brings its own bar.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [Bar, barShown]);

  // It is asked for at once when the box is entered (its field, above, or a button of the bar from
  // the keyboard) or pressed anywhere: a ⋮ or the emoji picker too, which need no editor to open.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.addEventListener("focusin", load);
    element.addEventListener("click", load);
    return () => {
      element.removeEventListener("focusin", load);
      element.removeEventListener("click", load);
    };
  }, [load]);

  // Requests from elsewhere in the composer (an attachment's tag to put in or take out) are taken
  // by the plain field until the editor is there. Those that arrive after the field is gone and
  // before the editor listens are kept, and handed to the editor once it says it is ready.
  const ready = useRef(false);
  const queue = useRef<ComposerRequest[]>([]);
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    form.current = field.current?.form ?? null;
    return onComposerRequest(form.current, (request) => {
      if (ready.current) return;
      const box = field.current;
      if ("drop" in request) {
        // Files are the editor's to take: it is asked for, and gets them when it is there.
        queue.current.push(request);
        load();
      } else if (!box || "uploaded" in request) queue.current.push(request);
      else if ("insert" in request) {
        insertAtCaret(box, request.insert, entered.current);
        changed.current?.(box.value);
      } else {
        box.value = withoutAttachTag(box.value, request.remove);
        changed.current?.(box.value);
      }
    });
  }, [load]);
  const inbox = useRef<ReturnType<typeof quoteInbox>>(undefined);
  const editorReady = useCallback(() => {
    ready.current = true;
    for (const request of queue.current.splice(0)) {
      requestOnComposer(form.current, request);
    }
    inbox.current?.ready();
  }, []);

  // A file dropped anywhere on the composer is the composer's: left alone the browser would open it
  // and take the member off the page with what they wrote. The editor takes it, as it takes one
  // dropped on its text (which it has dealt with by the time the drop gets here).
  useEffect(() => {
    const target = field.current?.form;
    if (!target) return;
    const files = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") === true;
    const over = (event: DragEvent) => {
      if (files(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!files(event) || event.defaultPrevented) return;
      event.preventDefault();
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length > 0) requestOnComposer(target, { drop: dropped });
    };
    target.addEventListener("dragover", over);
    target.addEventListener("drop", drop);
    return () => {
      target.removeEventListener("dragover", over);
      target.removeEventListener("drop", drop);
    };
  }, []);

  // Text added from elsewhere on the page goes at the end of the plain field, as it would in the
  // editor, and the editor is asked for so that it is there for what comes next.
  useEffect(() => {
    if (!insertEvent) return;
    const quotes = quoteInbox({
      event: insertEvent,
      target: window,
      field: () => field.current,
      onFilled: (text) => changed.current?.(text),
      load,
    });
    inbox.current = quotes;
    return quotes.detach;
  }, [insertEvent, load]);

  if (loaded) {
    return (
      <loaded.Editor
        compact={compact}
        toolbar
        autoFocus={loaded.focused}
        selection={loaded.selection}
        name={name}
        placeholder={placeholder}
        defaultValue={loaded.text}
        minHeight={minHeight}
        findMembers={findMembers}
        insertEvent={insertEvent}
        onChange={onChange}
        onInsertReady={editorReady}
        pressed={kept.pressed}
        toolbarMemory={memory.current}
        className={className}
      />
    );
  }
  return (
    <div ref={box} className={cn("group/editor", EDITOR_BOX, className)}>
      {barShown &&
        (Bar ? (
          <ToolbarContext.Provider value={toolbar}>
            <Bar />
          </ToolbarContext.Provider>
        ) : (
          // The bar's band at rest, as tall as the bar (its padding round a 42 px group).
          <div
            aria-hidden="true"
            className="rounded-t-[inherit] border-b bg-border p-1.5 group-focus-within/editor:bg-transparent"
          >
            <div className="h-[42px]" />
          </div>
        ))}
      <textarea
        ref={field}
        name={name}
        defaultValue={defaultValue}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        // Its own handler, there from the first draw: a composer that focuses the field as soon as
        // it is drawn (a feed card's Reply) does so before the box's listeners below are added.
        onFocus={() => {
          entered.current = true;
          load();
        }}
        onPaste={takePastedFiles}
        onKeyDown={submitOnShortcut}
        onInput={(event) => {
          load();
          onChange?.(event.currentTarget.value);
        }}
        style={{ minHeight }}
        className={cn(
          "block field-sizing-content w-full resize-none bg-transparent outline-none placeholder:text-foreground/40",
          EDITOR_TEXT,
          editorPadding(compact),
        )}
      />
    </div>
  );
}
