"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pointerOver } from "@/components/forum/member-card-intent";
import {
  CARD_CLOSE_DELAY,
  CARD_DELAY,
  MemberCardPopup,
  useMemberCard,
} from "@/components/forum/member-card-popup";
import { useMemberCardsEnabled } from "@/components/forum/member-card-scope";
import { Popover } from "@/components/ui/popover";

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

// Wraps rendered post content (the HTML stays the server's children) and shows the card of a
// member when the mouse rests on a mention of them. One popover is
// shared by all the mentions inside, anchored to the link. A click is never intercepted, and
// touch and pen get the plain link. Inside a postbit's scope it does nothing.
export function MentionCards({ children }: { children: React.ReactNode }) {
  const enabled = useMemberCardsEnabled();
  const [target, setTarget] = useState<Mention | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popup = useRef<HTMLDivElement>(null);

  // The page can be kept hidden when the visitor navigates away (Activity): a card is transient.
  useLayoutEffect(
    () => () => {
      clearTimeout(timer.current);
      setTarget(null);
    },
    [],
  );

  if (!enabled) return children;

  function later(run: () => void, delay: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  }
  const keep = () => clearTimeout(timer.current);
  // A pointer still on the mention or the card has not left (the card can be rewritten under it
  // and the browser then reports a leave).
  const close = (link: Element) =>
    later(() => {
      if (!pointerOver(link, popup.current)) setTarget(null);
    }, CARD_CLOSE_DELAY);

  return (
    <div
      className="contents"
      onPointerOver={(event) => {
        if (event.pointerType !== "mouse") return;
        const mention = mentionAt(event.target, event.currentTarget);
        if (!mention) return;
        if (target?.link === mention.link) keep();
        else
          later(() => {
            // The HTML can be replaced by a refresh while the mouse rests.
            if (mention.link.isConnected) setTarget(mention);
          }, CARD_DELAY);
      }}
      onPointerOut={(event) => {
        if (event.pointerType !== "mouse") return;
        const mention = mentionAt(event.target, event.currentTarget);
        if (!mention) return;
        const next = event.relatedTarget;
        if (next instanceof Node && mention.link.contains(next)) return;
        close(mention.link);
      }}
    >
      {children}
      {target && (
        <MentionPopup
          key={target.seq}
          mention={target}
          popup={popup}
          onKeep={keep}
          onClose={() => close(target.link)}
          onDismiss={() => {
            clearTimeout(timer.current);
            setTarget(null);
          }}
        />
      )}
    </div>
  );
}

function MentionPopup({
  mention,
  popup,
  onKeep,
  onClose,
  onDismiss,
}: {
  mention: Mention;
  popup: React.RefObject<HTMLDivElement | null>;
  onKeep: () => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const { card, load } = useMemberCard(mention.id, mention.name);
  useEffect(load, [load]);
  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <MemberCardPopup
        name={mention.name}
        card={card}
        reload={load}
        ref={popup}
        anchor={mention.link}
        align="start"
        initialFocus={false}
        // Focus is never moved by this card; it goes back to the link only from inside the card.
        finalFocus={() =>
          popup.current?.contains(document.activeElement)
            ? (mention.link as HTMLElement)
            : false
        }
        onPointerEnter={onKeep}
        onPointerLeave={onClose}
      />
    </Popover>
  );
}
