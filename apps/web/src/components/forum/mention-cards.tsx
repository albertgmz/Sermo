"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { opensCard, opensCardKey } from "@/components/forum/member-card-intent";
import {
  MemberCardSurface,
  useMemberCard,
} from "@/components/forum/member-card-popup";
import { useMemberCardsEnabled } from "@/components/forum/member-card-scope";

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

  // The page can be kept hidden when the visitor navigates away (Activity): a card is transient.
  useLayoutEffect(
    () => () => {
      setTarget(null);
    },
    [],
  );

  if (!enabled) return children;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: one delegate for the mention links inside, which are the focusable, keyboard-reachable elements
    <div
      className="contents"
      onClick={(event) => {
        const mention = clickedMention(event, event.currentTarget);
        if (!mention) return;
        event.preventDefault();
        setTarget(mention);
      }}
      onKeyDown={(event) => {
        const mention = keyedMention(event, event.currentTarget);
        if (!mention) return;
        event.preventDefault();
        setTarget(mention);
      }}
    >
      {children}
      {target && (
        <MentionPopup
          key={target.seq}
          mention={target}
          onDismiss={() => setTarget(null)}
        />
      )}
    </div>
  );
}

function MentionPopup({
  mention,
  onDismiss,
}: {
  mention: Mention;
  onDismiss: () => void;
}) {
  const { card, load } = useMemberCard(mention.id, mention.name);
  useEffect(load, [load]);
  return (
    <MemberCardSurface
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      name={mention.name}
      card={card}
      reload={load}
      anchor={mention.link}
      finalFocus={() => mention.link as HTMLElement}
    />
  );
}
