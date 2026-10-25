"use client";

import { Bell, Bookmark, PenLine } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type JoinAsk, loginHref } from "@/lib/join-window";
import { cn } from "@/lib/utils";

// The sign-up window a guest gets for an action only members can take (`lib/join-window.ts`): the
// forum's icon, what the press asked for, what an account gives besides, and the two ways in:
// "Create account" first, then "Log in", which comes back to the page. It closes with its ×,
// Escape or a press outside it, and when the guest leaves for either page.
export function JoinWindow({
  ask,
  open,
  onOpenChange,
  appName,
  icon,
}: {
  ask: JoinAsk;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appName: string;
  icon: React.ReactNode;
}) {
  const t = useTranslations("layout.signupNudges");
  const close = () => onOpenChange(false);
  const perks = [
    { icon: Bell, text: t("window.perks.notify") },
    { icon: PenLine, text: t("window.perks.name") },
    { icon: Bookmark, text: t("window.perks.keep") },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-sm">
        <DialogHeader className="items-center gap-3 text-center">
          <div className="size-14 overflow-hidden rounded-2xl ring-1 ring-border">
            {icon}
          </div>
          <DialogTitle className="text-lg leading-snug font-semibold text-balance">
            {t(`window.title.${ask.reason}`)}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {t("window.body", { site: appName })}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          {perks.map((perk) => (
            <li key={perk.text} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-ink"
              >
                <perk.icon className="size-4" />
              </span>
              <span className="text-pretty">{perk.text}</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2">
          <Link
            href="/register"
            onClick={close}
            className={cn(buttonVariants(), "h-10")}
          >
            {t("register")}
          </Link>
          <Link
            href={loginHref(ask.next)}
            onClick={close}
            className={cn(buttonVariants({ variant: "outline" }), "h-10")}
          >
            {t("login")}
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
