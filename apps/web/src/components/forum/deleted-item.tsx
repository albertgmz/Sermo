"use client";

import { createContext, use, useId, useReducer, useRef } from "react";

// Whether a deleted item is open, and the press that opens or folds it (`DeletedToggle`).
const Shown = createContext<{
  open: boolean;
  toggle: () => void;
  id: string;
  pressed: React.RefObject<boolean>;
} | null>(null);

// A deleted post, message, wall post or comment as XenForo draws one for the staff who see it: one
// line (`collapsed`) saying who deleted it, when and why, until "Show…" opens the whole item
// (`children`) in its place, whose "Hide" folds it again. Both are in the page already: nothing is
// loaded and the address does not change. The focus follows the toggle from one to the other.
export function DeletedItem({
  collapsed,
  children,
}: {
  collapsed: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, toggle] = useReducer((shown: boolean) => !shown, false);
  const id = useId();
  const pressed = useRef(false);
  return (
    <Shown
      value={{
        open,
        id,
        pressed,
        toggle: () => {
          pressed.current = true;
          toggle();
        },
      }}
    >
      {open ? children : collapsed}
    </Shown>
  );
}

// "Show…" on the folded item, "Hide" on the open one; nothing outside a `DeletedItem`.
export function DeletedToggle({ show, hide }: { show: string; hide: string }) {
  const shown = use(Shown);
  if (!shown) return null;
  return (
    <button
      type="button"
      id={shown.id}
      aria-expanded={shown.open}
      onClick={shown.toggle}
      // The toggle drawn after a press takes the focus the pressed one had.
      ref={(button) => {
        if (!button || !shown.pressed.current) return;
        shown.pressed.current = false;
        button.focus();
      }}
      className="relative rounded-sm font-semibold whitespace-nowrap text-primary-ink outline-none after:absolute after:-inset-x-2 after:-inset-y-3 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {shown.open ? hide : show}
    </button>
  );
}
