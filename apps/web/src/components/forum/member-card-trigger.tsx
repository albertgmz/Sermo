"use client";

import Link from "next/link";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  openChange,
  opensOnFocus,
  pointerOver,
  staysOpen,
} from "@/components/forum/member-card-intent";
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

// The trigger is a link that a click never turns into a popup: it announces no popup state.
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
  const popup = useRef<HTMLDivElement>(null);
  const pointerType = useRef("");
  const restoringFocus = useRef(false);
  const returnFocus = useRef(false);
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

  function show() {
    setOpen(true);
    load();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // A close the hover logic asks for while the pointer still rests on the name or the
        // card (the card was rewritten under it) is not the visitor leaving.
        if (
          !next &&
          staysOpen(details.reason, pointerOver(trigger.current, popup.current))
        )
          return;
        returnFocus.current = details.reason === "escape-key";
        const change = openChange(next, pointerType.current);
        if (change === "close") setOpen(false);
        else if (change === "open") show();
      }}
    >
      <PopoverTrigger
        ref={setTrigger}
        nativeButton={false}
        role="link"
        openOnHover
        delay={CARD_DELAY}
        closeDelay={CARD_CLOSE_DELAY}
        render={<Link href={href} />}
        aria-label={rest["aria-label"]}
        {...NOT_A_POPUP_BUTTON}
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
          const focusVisible = event.currentTarget.matches(":focus-visible");
          // Focus that shows a focus ring came from the keyboard, whatever was tapped before.
          if (focusVisible) pointerType.current = "";
          if (restoringFocus.current) {
            restoringFocus.current = false;
          } else if (
            opensOnFocus({
              pointerType: pointerType.current,
              avatar,
              focusVisible,
            })
          ) {
            show();
          }
        }}
        onClick={(event) => {
          // A click is always the link's own: it never toggles the card, and it closes it.
          event.preventBaseUIHandler();
          setOpen(false);
        }}
      >
        {children}
      </PopoverTrigger>
      <MemberCardPopup
        name={name}
        card={card}
        reload={load}
        ref={popup}
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
