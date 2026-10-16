"use client";

import { Ellipsis, MessagesSquare } from "lucide-react";
import Link from "next/link";
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
          render={<Link href={`${profileHref}?tab=posts`} />}
        >
          <MessagesSquare />
          {findPosts}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-10 md:min-h-8"
          render={<Link href={`${profileHref}?tab=threads`} />}
        >
          <MessagesSquare />
          {findThreads}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
