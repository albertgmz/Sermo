"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  CARD_CLOSE_DELAY,
  CARD_DELAY,
  MemberCardPopup,
  useMemberCard,
} from "@/components/forum/member-card-popup";
import { useMemberCardsEnabled } from "@/components/forum/member-card-scope";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { getCommittedLiteValue, subscribeLiteValue } from "@/lib/lite-sync";
import { cn } from "@/lib/utils";

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

// A link to a member's profile that shows the member's card on hover (mouse) and on keyboard
// focus. A tap on touch and pen is a plain click: it goes to the profile. Inside a postbit
// (`MemberCardScope`) it is just the link.
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

const isTouchLike = (pointerType: string) =>
  pointerType === "touch" || pointerType === "pen";

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
  const { card, load, reload } = useMemberCard(id, name);
  const trigger = useRef<HTMLElement>(null);
  const pointerType = useRef("");
  const restoringFocus = useRef(false);
  const returnFocus = useRef(false);

  function show() {
    setOpen(true);
    load();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        returnFocus.current = details.reason === "escape-key";
        if (!next) setOpen(false);
        else if (!isTouchLike(pointerType.current)) show();
      }}
    >
      <PopoverTrigger
        ref={(element) => {
          trigger.current = element;
        }}
        nativeButton={false}
        role="link"
        openOnHover
        delay={CARD_DELAY}
        closeDelay={CARD_CLOSE_DELAY}
        render={<Link href={href} />}
        aria-label={rest["aria-label"]}
        className={classes(avatar, className)}
        style={style}
        onPointerOver={(event) => {
          pointerType.current = event.pointerType;
        }}
        onPointerDown={(event) => {
          pointerType.current = event.pointerType;
        }}
        onKeyDown={() => {
          pointerType.current = "";
        }}
        onFocus={(event) => {
          if (restoringFocus.current) {
            restoringFocus.current = false;
          } else if (
            !isTouchLike(pointerType.current) &&
            event.currentTarget.matches(":focus-visible")
          ) {
            show();
          }
        }}
        onClick={(event) => {
          // A click is always the link's own: it never toggles the card.
          event.preventBaseUIHandler();
        }}
      >
        {children}
      </PopoverTrigger>
      <MemberCardPopup
        name={name}
        card={card}
        reload={reload}
        align="start"
        initialFocus={false}
        finalFocus={() => {
          if (
            returnFocus.current &&
            document.activeElement !== trigger.current
          ) {
            restoringFocus.current = true;
            return trigger.current;
          }
          return false;
        }}
      />
    </Popover>
  );
}
