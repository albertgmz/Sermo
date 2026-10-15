"use client";

import { useLayoutEffect, useState } from "react";
import { opensCard, opensCardKey } from "@/components/forum/member-card-intent";
import { useMemberCardsEnabled } from "@/components/forum/member-card-scope";
import { fetchCode, loadedCode } from "@/components/ui/lazy-popup-gate";

// The card (Base UI, the positioning, the sheet and the server action that reads it) is fetched
// when a mention is first reached for, and shown by the click that follows (as soon as it is
// there). Without it a mention is still a link.
const loadPopup = () => import("@/components/forum/mention-popup");

const MENTION = "a.mention[data-user-id]";

// The id a mention carries: a plain positive decimal and nothing else.
export function mentionId(value: string | null | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export type Mention = { link: Element; id: number; name: string; seq: number };

let seq = 0;

// The mention a node belongs to, when it is one inside `root`.
export function mentionAt(
  node: EventTarget | null,
  root: { contains(other: Node | null): boolean },
): Mention | null {
  const link = (node as Element | null)?.closest?.(MENTION);
  if (!link || !root.contains(link)) return null;
  const id = mentionId(link.getAttribute("data-user-id"));
  if (id === null) return null;
  const name = (link.textContent ?? "").trim().replace(/^@/, "");
  return { link, id, name, seq: ++seq };
}

// The mention a click or a key press asks to open: a plain click, or Space, on a mention.
export function clickedMention(
  event: Parameters<typeof opensCard>[0] & { target: EventTarget | null },
  root: Parameters<typeof mentionAt>[1],
) {
  return opensCard(event) ? mentionAt(event.target, root) : null;
}
export function keyedMention(
  event: { key: string; target: EventTarget | null },
  root: Parameters<typeof mentionAt>[1],
) {
  return opensCardKey(event.key) ? mentionAt(event.target, root) : null;
}

// Wraps rendered post content (the HTML stays the server's children) and shows the card of a
// member when a mention of them is clicked (or Enter or Space is pressed on it). One card is
// shared by all the mentions inside, anchored to the link. A modified click keeps the link's own
// behaviour. Inside a postbit's scope it does nothing.
export function MentionCards({ children }: { children: React.ReactNode }) {
  const enabled = useMemberCardsEnabled();
  const [target, setTarget] = useState<Mention | null>(null);
  const Popup = loadedCode(loadPopup);

  // The page can be kept hidden when the visitor navigates away (Activity): a card is transient.
  useLayoutEffect(
    () => () => {
      setTarget(null);
    },
    [],
  );

  if (!enabled) return children;

  // The link of the open card closes it. A card whose code has not come yet opens when it does; if
  // it cannot come, the mention is the link it always was.
  function choose(mention: Mention) {
    if (target?.link === mention.link) return setTarget(null);
    if (Popup) return setTarget(mention);
    fetchCode(loadPopup).then(
      () => setTarget(mention),
      () => {
        const href = mention.link.getAttribute("href");
        if (href) window.location.assign(href);
      },
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: one delegate for the mention links inside, which are the focusable, keyboard-reachable elements
    <div
      className="contents"
      onPointerOver={(event) => {
        if (mentionAt(event.target, event.currentTarget))
          fetchCode(loadPopup).catch(() => {});
      }}
      onClick={(event) => {
        const mention = clickedMention(event, event.currentTarget);
        if (!mention) return;
        event.preventDefault();
        choose(mention);
      }}
      onKeyDown={(event) => {
        const mention = keyedMention(event, event.currentTarget);
        if (!mention) return;
        event.preventDefault();
        choose(mention);
      }}
    >
      {children}
      {target && Popup && (
        <Popup
          key={target.seq}
          mention={target}
          onDismiss={() => setTarget(null)}
        />
      )}
    </div>
  );
}
