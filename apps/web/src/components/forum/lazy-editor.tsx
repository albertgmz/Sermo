"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  type ComposerRequest,
  insertAtCaret,
  onComposerRequest,
  requestOnComposer,
  takePastedFiles,
  withoutAttachTag,
} from "@/components/forum/composer-insert";
import type { Editor, EditorProps } from "@/components/forum/editor";
import { quoteInbox } from "@/components/forum/lazy-quotes";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Loaded = {
  Editor: typeof Editor;
  text: string;
  focused: boolean;
  // Where the caret or selection of the box was in `text`.
  selection: { start: number; end: number };
};

// A plain box that becomes the editor, formatting bar included, when the member goes to write
// in it. The editor's code is asked for only then, so it is no part of the page's first load. The
// box is a field of the form like the editor is: what is typed while the editor is on its way is
// handed to it, and a form sent before it arrives carries the text all the same.
export function LazyEditor({
  name,
  placeholder,
  defaultValue,
  compact = true,
  minHeight = compact ? 40 : 120,
  findMembers,
  insertEvent,
  onChange,
  className,
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
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const asked = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>();
  const changed = useRef(onChange);
  changed.current = onChange;

  const load = useCallback(() => {
    if (asked.current) return;
    asked.current = true;
    setWaiting(true);
    import("@/components/forum/editor").then(
      // The text is read and the editor put in its place in one go: a key pressed in between
      // would be typed into a box that is about to go.
      ({ Editor }) =>
        flushSync(() =>
          setLoaded({
            Editor,
            text: field.current?.value ?? "",
            focused: document.activeElement === field.current,
            selection: {
              start: field.current?.selectionStart ?? 0,
              end: field.current?.selectionEnd ?? 0,
            },
          }),
        ),
      // The box keeps working as it is, and asks again the next time it is entered.
      () => {
        asked.current = false;
        setWaiting(false);
      },
    );
  }, []);

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
        insertAtCaret(box, request.insert, asked.current);
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
        className={className}
      />
    );
  }
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card transition-colors focus-within:border-ring",
        className,
      )}
    >
      {/* The room the formatting bar takes, from the first tap, so nothing moves when it comes:
          its padding and a group's box (a 32 px button between 2 px margins and a border). */}
      {waiting && (
        <div className="rounded-t-[inherit] border-b bg-muted p-1">
          <Skeleton className="h-[38px] w-48 max-w-full rounded-lg" />
        </div>
      )}
      <textarea
        ref={field}
        name={name}
        defaultValue={defaultValue}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={load}
        onPaste={takePastedFiles}
        onInput={(event) => {
          load();
          onChange?.(event.currentTarget.value);
        }}
        style={{ minHeight }}
        className={cn(
          "block field-sizing-content w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm",
          compact ? "px-3 py-2" : "px-4 py-3",
        )}
      />
    </div>
  );
}
