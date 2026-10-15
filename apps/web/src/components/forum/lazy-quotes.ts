// What `LazyEditor` does with the text the page adds to its writing box by a window event (the
// quote button of a post) while the editor is not there yet. In the editor, `InsertPlugin` adds
// the BB code at the end and puts the caret in a new paragraph below it; this does the same for
// the plain field and hands the rest over once the editor listens.

type Field = {
  value: string;
  setSelectionRange(start: number, end: number): void;
  focus(): void;
};

export function quoteInbox({
  event,
  target,
  field,
  onFilled,
  load,
  defer = (run) => {
    setTimeout(run, 0);
  },
}: {
  event: string;
  target: Pick<
    EventTarget,
    "addEventListener" | "removeEventListener" | "dispatchEvent"
  >;
  // The plain field, or null while it is gone and the editor is on its way.
  field: () => Field | null;
  // The field's text changed.
  onFilled: (text: string) => void;
  // Asks for the editor.
  load: () => void;
  defer?: (run: () => void) => void;
}) {
  let ready = false;
  // Quotes that arrived with no plain field and no editor listening.
  const held: string[] = [];
  // Whether a quote went into the plain field's text.
  let quoted = false;

  const listener = (occurred: Event) => {
    // From here the editor's own listener takes the event.
    if (ready) return;
    const bb = String((occurred as CustomEvent<string>).detail ?? "");
    const box = field();
    if (!box) {
      held.push(bb);
      return;
    }
    const current = box.value.trimEnd();
    box.value = `${current ? `${current}\n\n` : ""}${bb}\n\n`;
    box.setSelectionRange(box.value.length, box.value.length);
    box.focus();
    quoted = true;
    onFilled(box.value);
    load();
  };
  target.addEventListener(event, listener);

  return {
    detach: () => target.removeEventListener(event, listener),
    // The editor takes requests now. It listens from an effect that runs just after it says so,
    // hence the delay. A quote in the text it opened with ends in a quote block and the caret
    // would land inside it, so an empty one makes the editor add the paragraph below.
    ready: () => {
      ready = true;
      const replay = held.splice(0);
      const send = replay.length > 0 ? replay : quoted ? [""] : [];
      if (send.length === 0) return;
      defer(() => {
        for (const detail of send)
          target.dispatchEvent(new CustomEvent(event, { detail }));
      });
    },
  };
}
