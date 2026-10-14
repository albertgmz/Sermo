"use client";

import { ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { logout } from "@/app/[locale]/(main)/actions";
import { LiteModeToggle } from "@/components/layout/lite-mode-toggle";
import { type LinkItem, linkProps } from "@/components/layout/nav";
import { NavLabel } from "@/components/layout/nav-label";
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

export function UserMenu({
  user,
  links,
  avatar,
  lite,
}: {
  user: { username: string; title: string };
  links: LinkItem[];
  avatar: React.ReactNode;
  lite: LiteState;
}) {
  const t = useTranslations("layout.userMenu");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("aria.account")}
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
        {links.map((link) => (
          <DropdownMenuItem
            key={link.id}
            className="min-h-10 md:min-h-8"
            render={<Link {...linkProps(link)} />}
          >
            <NavLabel item={link} withDefault className="" />
          </DropdownMenuItem>
        ))}
        <LiteModeToggle state={lite} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-10 md:min-h-8"
          onClick={() => logout()}
        >
          <LogOut />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
