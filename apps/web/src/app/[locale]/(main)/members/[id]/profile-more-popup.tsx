"use client";

import { Ellipsis, MessagesSquare } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { goInPlace } from "@/components/forum/tab-switch-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";

export type ProfileMorePopupProps = {
  label: string;
  className: string;
  profileHref: string;
  findPosts: string;
  findThreads: string;
};

// A link to a tab of the profile: the profile's tabs show it in place (`goInPlace`).
function TabLink(props: ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        if (goInPlace(props.href)) event.preventDefault();
      }}
    />
  );
}

// The button and its menu, which Base UI draws. It is loaded when the plain button of
// `ProfileMore` is pressed and mounts open.
export default function ProfileMorePopup({
  label,
  className,
  profileHref,
  findPosts,
  findThreads,
  openedBy,
  openKey,
}: ProfileMorePopupProps & OpenedProps) {
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={label}
        className={className}
      >
        <Ellipsis className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem
          className="min-h-10 md:min-h-8"
          render={<TabLink href={`${profileHref}?tab=posts`} />}
        >
          <MessagesSquare />
          {findPosts}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-10 md:min-h-8"
          render={<TabLink href={`${profileHref}?tab=threads`} />}
        >
          <MessagesSquare />
          {findThreads}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
