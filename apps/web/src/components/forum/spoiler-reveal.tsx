"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { revealSpoiler } from "@/components/forum/spoiler-action";
import type { TaggedAttachment } from "@/lib/attachment-tags";

// What the spoilers of a body belong to: the key `spoilers.get` takes.
export type SpoilerContent = {
  type:
    | "post"
    | "profile_post"
    | "profile_post_comment"
    | "conversation_message";
  id: number;
};

// Presses of a spoiler button inside `root`: asks for that spoiler and puts it in place. Returns
// false when it was refused or failed (the button is pressable again), true otherwise.
export async function openSpoiler(
  target: EventTarget | null,
  root: { contains(node: Node | null): boolean },
  content: SpoilerContent,
  attachments: TaggedAttachment[] = [],
): Promise<boolean> {
  const button = (target as Element | null)?.closest?.<HTMLButtonElement>(
    "button[data-spoiler-button]",
  );
  const holder = button?.parentElement;
  if (!button || !holder || button.disabled || !root.contains(button))
    return true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  let revealed: { html: string } | null = null;
  try {
    revealed = await revealSpoiler(
      content.type,
      content.id,
      Number(holder.dataset.spoiler),
      attachments,
    );
  } catch {
    revealed = null;
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
  if (!holder.isConnected) return true;
  if (!revealed) {
    button.setAttribute("aria-invalid", "true");
    return false;
  }
  holder.innerHTML = revealed.html;
  holder.classList.add("bb-spoiler-open");
  // The button that had focus is gone: keep the reader where they were.
  holder.tabIndex = -1;
  holder.focus({ preventScroll: true });
  return true;
}

// Wraps rendered content whose spoilers are buttons (`withSpoilerButtons`). Pressing one asks for
// that spoiler and puts it in place; one inside it works the same. Delegated, so the server's HTML
// stays the children. A refusal is said in a polite live region. The `attachments` of the item
// take the place of the `[ATTACH]` tags inside the spoiler, as they do in the body.
export function SpoilerReveal({
  content,
  attachments,
  children,
}: {
  content: SpoilerContent;
  attachments?: TaggedAttachment[];
  children: React.ReactNode;
}) {
  const t = useTranslations("forum.bbCode");
  const [failed, setFailed] = useState(false);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the buttons inside take the keyboard; this only listens for their clicks. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Enter and Space on a button arrive as clicks. */}
      <div
        className="contents"
        onClick={async (event) => {
          const ok = await openSpoiler(
            event.target,
            event.currentTarget,
            content,
            attachments,
          );
          setFailed(!ok);
        }}
      >
        {children}
      </div>
      <p
        role="status"
        aria-live="polite"
        className="text-xs text-destructive empty:hidden"
      >
        {failed ? t("spoilerFailed") : null}
      </p>
    </>
  );
}
