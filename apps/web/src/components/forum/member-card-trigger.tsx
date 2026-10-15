"use client";

import Link from "next/link";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { OpenedMemberCardProps } from "@/components/forum/member-card-opened";
import { useMemberCardsEnabled } from "@/components/forum/member-card-scope";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { getCommittedLiteValue, subscribeLiteValue } from "@/lib/lite-sync";
import { cn } from "@/lib/utils";

// The card (Base UI, the positioning, the sheet and the server action that reads it) is fetched when
// a name or avatar is first reached for.
const loadCard = () => import("@/components/forum/member-card-opened");

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
// Enter and Space on the keyboard). Until it is first reached for it is a plain link. A modified click goes to the profile as a link does. Inside
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

  // The page can be kept hidden when the visitor navigates away (Activity): a card is transient.
  useLayoutEffect(
    () => () => {
      setOpen(false);
    },
    [],
  );

  const classNames = classes(avatar, className);
  const popup: OpenedMemberCardProps = {
    id,
    href,
    name,
    className: classNames,
    style,
    "aria-label": rest["aria-label"],
    children,
    open,
    onOpenChange: setOpen,
  };
  return (
    <LazyPopup
      load={loadCard}
      popup={popup}
      opening="link"
      onOpen={() => setOpen(true)}
      onLoadError={() => {
        // Without the card the name is still a link.
        window.location.assign(href);
      }}
      trigger={(lazy) => (
        <Link
          href={href}
          role="link"
          data-slot="popover-trigger"
          aria-label={rest["aria-label"]}
          aria-haspopup="dialog"
          aria-expanded="false"
          className={classNames}
          style={style}
          {...lazy}
        >
          {children}
        </Link>
      )}
    />
  );
}
