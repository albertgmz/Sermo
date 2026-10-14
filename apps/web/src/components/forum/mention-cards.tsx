"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isPressOnAnchor,
  opensCard,
  opensCardKey,
  returnsFocusToLink,
} from "@/components/forum/member-card-intent";
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
        // The link of the open card closes it.
        setTarget(target?.link === mention.link ? null : mention);
      }}
      onKeyDown={(event) => {
        const mention = keyedMention(event, event.currentTarget);
        if (!mention) return;
        event.preventDefault();
        setTarget(target?.link === mention.link ? null : mention);
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
  const popup = useRef<HTMLDivElement>(null);
  const reason = useRef<string | undefined>(undefined);
  useEffect(load, [load]);
  // The link says it opens a dialog, and that it is open, while the card is.
  useEffect(() => {
    const { link } = mention;
    link.setAttribute("aria-haspopup", "dialog");
    link.setAttribute("aria-expanded", "true");
    return () => {
      link.removeAttribute("aria-haspopup");
      link.removeAttribute("aria-expanded");
    };
  }, [mention]);
  return (
    <MemberCardSurface
      open
      onOpenChange={(next, details) => {
        reason.current = details.reason;
        if (!next && !isPressOnAnchor(details, mention.link)) onDismiss();
      }}
      popupRef={popup}
      name={mention.name}
      card={card}
      reload={load}
      anchor={mention.link}
      finalFocus={() =>
        returnsFocusToLink({
          reason: reason.current,
          focusInside: popup.current?.contains(document.activeElement) ?? false,
          connected: mention.link.isConnected,
        })
          ? (mention.link as HTMLElement)
          : false
      }
    />
  );
}
