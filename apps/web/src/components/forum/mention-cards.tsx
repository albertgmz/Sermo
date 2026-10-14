"use client";

import { useEffect, useRef, useState } from "react";
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
// member when the mouse rests on a mention of them or the keyboard focuses it. One popover is
// shared by all the mentions inside, anchored to the link. A click is never intercepted, and
// touch and pen get the plain link. Inside a postbit's scope it does nothing.
export function MentionCards({ children }: { children: React.ReactNode }) {
  const enabled = useMemberCardsEnabled();
  const [target, setTarget] = useState<Mention | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const returnFocus = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!enabled) return children;

  function later(run: () => void, delay: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  }
  const keep = () => clearTimeout(timer.current);
  const close = () => later(() => setTarget(null), CARD_CLOSE_DELAY);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates the pointer and focus events of the links inside; the wrapper itself is not a control.
    <div
      className="contents"
      onPointerOver={(event) => {
        if (event.pointerType !== "mouse") return;
        const mention = mentionAt(event.target, event.currentTarget);
        if (!mention) return;
        if (target?.link === mention.link) keep();
        else later(() => setTarget(mention), CARD_DELAY);
      }}
      onPointerOut={(event) => {
        if (event.pointerType !== "mouse") return;
        const mention = mentionAt(event.target, event.currentTarget);
        if (!mention) return;
        const next = event.relatedTarget;
        if (next instanceof Node && mention.link.contains(next)) return;
        close();
      }}
      onFocus={(event) => {
        const mention = mentionAt(event.target, event.currentTarget);
        if (!mention || !event.target.matches(":focus-visible")) return;
        keep();
        setTarget(mention);
      }}
      onBlur={(event) => {
        if (mentionAt(event.target, event.currentTarget)) close();
      }}
    >
      {children}
      {target && (
        <MentionPopup
          key={target.seq}
          mention={target}
          onKeep={keep}
          onClose={close}
          onDismiss={(viaEscape) => {
            returnFocus.current = viaEscape;
            clearTimeout(timer.current);
            setTarget(null);
          }}
          returnFocus={returnFocus}
        />
      )}
    </div>
  );
}

function MentionPopup({
  mention,
  onKeep,
  onClose,
  onDismiss,
  returnFocus,
}: {
  mention: Mention;
  onKeep: () => void;
  onClose: () => void;
  onDismiss: (viaEscape: boolean) => void;
  returnFocus: React.RefObject<boolean>;
}) {
  const { card, load, reload } = useMemberCard(mention.id, mention.name);
  useEffect(load, [load]);
  return (
    <Popover
      open
      onOpenChange={(next, details) => {
        if (!next) onDismiss(details.reason === "escape-key");
      }}
    >
      <MemberCardPopup
        name={mention.name}
        card={card}
        reload={reload}
        anchor={mention.link}
        align="start"
        initialFocus={false}
        finalFocus={() => {
          const link = mention.link as HTMLElement;
          return returnFocus.current && document.activeElement !== link
            ? link
            : false;
        }}
        onPointerEnter={onKeep}
        onPointerLeave={onClose}
      />
    </Popover>
  );
}
