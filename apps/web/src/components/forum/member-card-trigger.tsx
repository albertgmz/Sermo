"use client";

import Link from "next/link";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { opensCard, opensCardKey } from "@/components/forum/member-card-intent";
import {
  MemberCardSurface,
  useMemberCard,
} from "@/components/forum/member-card-popup";
import { useMemberCardsEnabled } from "@/components/forum/member-card-scope";
import { PopoverTrigger } from "@/components/ui/popover";
import { getCommittedLiteValue, subscribeLiteValue } from "@/lib/lite-sync";
import { cn } from "@/lib/utils";

// The trigger is a link, not a toggle button: it announces no popup state.
const NOT_A_POPUP_BUTTON = {
  "aria-haspopup": undefined,
  "aria-expanded": undefined,
};

type Props = {
  id: number;
  href: string;
  name: string;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
  // The link around an avatar: no hit area drawn around it, the picture's box stays as it is.
  avatar?: boolean;
  children: React.ReactNode;
};

// A line of text gets a hit area taller than the line; an avatar does not.
const classes = (avatar: boolean | undefined, className?: string) =>
  avatar
    ? className
    : cn(
        "relative rounded-sm after:absolute after:-inset-x-1 after:-inset-y-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      );

// A link to a member's profile that opens the member's card when clicked (mouse, touch, pen, or
// Enter and Space on the keyboard). A modified click goes to the profile as a link does. Inside
// a card (`MemberCardScope`) it is just the link.
export function MemberCardTrigger(props: Props) {
  const preference = useSyncExternalStore(
    subscribeLiteValue,
    getCommittedLiteValue,
    () => "",
  );
  const enabled = useMemberCardsEnabled();
  if (!enabled) {
    return (
      <Link
        href={props.href}
        aria-label={props["aria-label"]}
        className={classes(props.avatar, props.className)}
        style={props.style}
      >
        {props.children}
      </Link>
    );
  }
  return <MemberCardWithPreference key={preference} {...props} />;
}

function MemberCardWithPreference({
  id,
  href,
  name,
  className,
  style,
  avatar,
  children,
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const { card, load } = useMemberCard(id, name);
  const trigger = useRef<HTMLElement>(null);
  // One function for the life of the trigger: a new one on every render would make the trigger
  // let go of its element and take it again each time the card changes.
  const setTrigger = useCallback((element: HTMLElement | null) => {
    trigger.current = element;
  }, []);

  // The page can be kept hidden when the visitor navigates away (Activity): a card is transient.
  useLayoutEffect(
    () => () => {
      setOpen(false);
    },
    [],
  );

  function toggle() {
    if (!open) load();
    setOpen(!open);
  }

  return (
    <MemberCardSurface
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
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
          {...NOT_A_POPUP_BUTTON}
          className={classes(avatar, className)}
          style={style}
          onKeyDown={(event) => {
            if (!opensCardKey(event.key)) return;
            event.preventDefault();
            toggle();
          }}
          onClick={(event) => {
            // The card's own handler is replaced by this one; a modified click is the link's.
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
