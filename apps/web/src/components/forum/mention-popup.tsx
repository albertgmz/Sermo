"use client";

import { useEffect, useRef } from "react";
import {
  isPressOnAnchor,
  returnsFocusToLink,
} from "@/components/forum/member-card-intent";
import {
  MemberCardSurface,
  useMemberCard,
} from "@/components/forum/member-card-popup";
import type { Mention } from "@/components/forum/mention-cards";

// The card of one mention, which Base UI draws. Loaded by `MentionCards` when a mention is first
// reached for.
export default function MentionPopup({
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
