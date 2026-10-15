"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { opensCard } from "@/components/forum/member-card-intent";
import {
  MemberCardSurface,
  useMemberCard,
} from "@/components/forum/member-card-popup";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { PopoverTrigger } from "@/components/ui/popover";

export type OpenedMemberCardProps = {
  id: number;
  href: string;
  name: string;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
  children: React.ReactNode;
  // Whether the card is open, kept by `MemberCardTrigger` so that it can close the card when the
  // page is hidden.
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// The link that opens a member's card and the card itself, which Base UI draws. It is loaded when
// the plain link of `MemberCardTrigger` is first pressed, and mounts with the card open.
export default function OpenedMemberCard({
  id,
  href,
  name,
  className,
  style,
  children,
  open,
  onOpenChange,
  openedBy: _openedBy,
  ...rest
}: OpenedMemberCardProps & OpenedProps) {
  const { card, load } = useMemberCard(id, name);
  const trigger = useRef<HTMLElement>(null);
  // One function for the life of the trigger: a new one on every render would make the trigger
  // let go of its element and take it again each time the card changes.
  const setTrigger = useCallback((element: HTMLElement | null) => {
    trigger.current = element;
  }, []);

  // The press that loaded this opened the card: read it.
  useEffect(load, [load]);

  function toggle() {
    if (!open) load();
    onOpenChange(!open);
  }

  return (
    <MemberCardSurface
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
      name={name}
      card={card}
      reload={load}
      trigger={
        <PopoverTrigger
          ref={setTrigger}
          nativeButton={false}
          role="link"
          render={<Link href={href} />}
          aria-label={rest["aria-label"]}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={className}
          style={style}
          onClick={(event) => {
            // Enter is a click on the link and Space becomes one on key up (Base UI), so this is
            // the one way in. The popover's own handler is replaced by this one; a modified click
            // is the link's.
            event.preventBaseUIHandler();
            if (!opensCard(event)) return;
            event.preventDefault();
            toggle();
          }}
        >
          {children}
        </PopoverTrigger>
      }
    />
  );
}
