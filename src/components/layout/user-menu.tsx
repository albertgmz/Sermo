"use client";

import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/(main)/actions";
import { LiteModeToggle } from "@/components/layout/lite-mode-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LiteState } from "@/lib/lite-preferences";
import type { User } from "@/lib/types";

export function UserMenu({
  user,
  avatar,
  lite,
}: {
  user: Pick<User, "id" | "username" | "title">;
  avatar: React.ReactNode;
  lite: LiteState;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="group flex h-10 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {avatar}
        <ChevronDown className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col py-1.5">
            <span className="text-sm font-semibold text-foreground">
              {user.username}
            </span>
            <span>{user.title}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-10 md:min-h-8"
          render={<Link href={`/members/${user.id}`} />}
        >
          <UserRound />
          Your profile
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-10 md:min-h-8"
          render={<Link href="/account" />}
        >
          <Settings />
          Account
        </DropdownMenuItem>
        <LiteModeToggle state={lite} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-10 md:min-h-8"
          onClick={() => logout()}
        >
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
