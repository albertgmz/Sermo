"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ComposerRequest,
  insertAtCaret,
  onComposerRequest,
  requestOnComposer,
  withoutAttachTag,
} from "@/components/forum/composer-insert";
import type { Editor, EditorProps } from "@/components/forum/editor";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Loaded = { Editor: typeof Editor; text: string; focused: boolean };

// A plain box that becomes the editor, formatting bar included, when the member goes to write
// in it. The editor's code is asked for only then, so it is no part of the page's first load. The
// box is a field of the form like the editor is: what is typed while the editor is on its way is
// handed to it, and a form sent before it arrives carries the text all the same.
export function LazyEditor({
  name,
  placeholder,
  defaultValue,
  minHeight = 40,
  toolbarContainer,
  findMembers,
  className,
}: {
  name: string;
  placeholder: string;
  // The text it opens with, to edit something written before.
  defaultValue?: string;
  // One line unless the composer gives the text more room.
  minHeight?: number;
  // The element of the composer's own bar that takes the formatting bar; without one it sits
  // above the text.
  toolbarContainer?: HTMLElement | null;
  findMembers?: EditorProps["findMembers"];
  className?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const asked = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>();
  const ownBar = toolbarContainer === undefined;

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
      if (!box) queue.current.push(request);
      else if ("insert" in request) {
        insertAtCaret(box, request.insert, asked.current);
      } else {
        box.value = withoutAttachTag(box.value, request.remove);
      }
    });
  }, []);
  const editorReady = useCallback(() => {
    ready.current = true;
    for (const request of queue.current.splice(0)) {
      requestOnComposer(form.current, request);
    }
  }, []);

  function load() {
    if (asked.current) return;
    asked.current = true;
    setWaiting(true);
    import("@/components/forum/editor").then(
      ({ Editor }) =>
        setLoaded({
          Editor,
          text: field.current?.value ?? "",
          focused: document.activeElement === field.current,
        }),
      // The box keeps working as it is, and asks again the next time it is entered.
      () => {
        asked.current = false;
        setWaiting(false);
      },
    );
  }

  if (loaded) {
    return (
      <loaded.Editor
        compact
        toolbar={ownBar}
        toolbarContainer={toolbarContainer}
        autoFocus={loaded.focused}
        name={name}
        placeholder={placeholder}
        defaultValue={loaded.text}
        minHeight={minHeight}
        findMembers={findMembers}
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
      {/* The room the formatting bar takes, from the first tap, so nothing moves when it comes. */}
      {waiting && ownBar && (
        <div className="border-b px-1.5 py-1">
          <Skeleton className="h-10 w-48 max-w-full md:h-8" />
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
        onInput={load}
        style={{ minHeight }}
        className="block field-sizing-content w-full resize-none bg-transparent px-3 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"
      />
    </div>
  );
}
