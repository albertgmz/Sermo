"use client";

import { useEffect, useId, useRef, useState } from "react";

// A form that opens in place under its button (a thread's tags, adding a poll): the focus goes to
// its first field when it opens (also one drawn later, as the poll editor's once its code is
// there), Escape closes it and hands the focus back to the button, as Cancel does, and opening one
// closes any other, so one is open at a time.

const closers = new Map<string, () => void>();

export function watchPanel(id: string, close: () => void) {
  closers.set(id, close);
  return () => {
    closers.delete(id);
  };
}

// The form `id` opened: the others close.
export function claimPanel(id: string) {
  for (const [other, close] of closers) if (other !== id) close();
}

// Escape closes the form when pressed in it and nothing took it first. A popup of the form drawn in a
// portal (a Base UI select or menu) still sends its keys through the form in React, so a key whose
// element is outside the form's box is left to that popup.
export function escapeCloses(event: {
  key: string;
  defaultPrevented: boolean;
  target: EventTarget | null;
  currentTarget: { contains: (node: Node | null) => boolean };
}) {
  return (
    event.key === "Escape" &&
    !event.defaultPrevented &&
    event.currentTarget.contains(event.target as Node | null)
  );
}

const FIELD =
  'input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea, select';

function focusFirstField(box: HTMLElement) {
  const focus = () => {
    const field = box.querySelector<HTMLElement>(FIELD);
    field?.focus();
    return field !== null;
  };
  if (focus()) return;
  const drawn = new MutationObserver(() => focus() && drawn.disconnect());
  drawn.observe(box, { childList: true, subtree: true });
  return () => drawn.disconnect();
}

// `button` goes on the opening button, `panel` on the box of the open form.
export function useInlinePanel() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);
  // Closed by the member (not by another form opening): the button drawn again takes the focus.
  const back = useRef(false);
  useEffect(() => watchPanel(id, () => setOpen(false)), [id]);
  useEffect(() => {
    if (!open || !box.current) return;
    claimPanel(id);
    return focusFirstField(box.current);
  }, [open, id]);
  const close = () => {
    back.current = true;
    setOpen(false);
  };
  return {
    open,
    show: () => setOpen(true),
    close,
    button: (node: HTMLButtonElement | null) => {
      if (!node || !back.current) return;
      back.current = false;
      node.focus();
    },
    panel: {
      ref: (node: HTMLElement | null) => {
        box.current = node;
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (!escapeCloses(event)) return;
        event.preventDefault();
        close();
      },
    },
  };
}
