"use client";

import { revealSpoiler } from "@/components/forum/spoiler-action";

// What the spoilers of a body belong to: the key `spoilers.get` takes.
export type SpoilerContent = {
  type:
    | "post"
    | "profile_post"
    | "profile_post_comment"
    | "conversation_message";
  id: number;
};

// Wraps rendered content whose spoilers are buttons (`withSpoilerButtons`). Pressing one asks for
// that spoiler and puts it in place; one inside it works the same. Delegated, so the server's HTML
// stays the children.
export function SpoilerReveal({
  content,
  children,
}: {
  content: SpoilerContent;
  children: React.ReactNode;
}) {
  async function open(event: React.MouseEvent<HTMLDivElement>) {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-spoiler-button]",
    );
    const holder = button?.parentElement;
    if (
      !button ||
      !holder ||
      button.disabled ||
      !event.currentTarget.contains(button)
    )
      return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const revealed = await revealSpoiler(
      content.type,
      content.id,
      Number(holder.dataset.spoiler),
    );
    if (!holder.isConnected) return;
    if (!revealed) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.setAttribute("aria-invalid", "true");
      return;
    }
    holder.innerHTML = revealed.html;
    holder.classList.add("bb-spoiler-open");
    // The button that had focus is gone: keep the reader where they were.
    holder.tabIndex = -1;
    holder.focus({ preventScroll: true });
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the buttons inside take the keyboard; this only listens for their clicks.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Enter and Space on a button arrive as clicks.
    <div className="contents" onClick={open}>
      {children}
    </div>
  );
}
