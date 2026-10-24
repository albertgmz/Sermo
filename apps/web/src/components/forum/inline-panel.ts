"use client";

import { useEffect, useId, useRef } from "react";

// A form that opens in place under the control that opened it (a thread's tags, adding a poll, both
// opened from the thread's "•••" menu): the focus goes to its first field when it opens (also one
// drawn later, as the poll editor's once its code is there), Escape closes it as Cancel does, and
// opening one closes any other, so one is open at a time. The opener keeps whether it is open and
// takes the focus back when it closes.

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

// For the box of an open form, drawn while it is open: `onClose` closes it (Escape, or another
// form opening).
export function useInlinePanel(onClose: () => void) {
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => watchPanel(id, () => close.current()), [id]);
  useEffect(() => {
    claimPanel(id);
    return box.current ? focusFirstField(box.current) : undefined;
  }, [id]);
  return {
    ref: (node: HTMLElement | null) => {
      box.current = node;
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!escapeCloses(event)) return;
      event.preventDefault();
      close.current();
    },
  };
}
