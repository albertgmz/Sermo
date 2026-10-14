"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemberCardClose } from "@/components/forum/member-card-scope";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The way from a member's card to their full profile. It closes the card as it goes.
export function MemberCardProfileLink({ id }: { id: number }) {
  const t = useTranslations("forum.memberCard");
  const close = useMemberCardClose();
  return (
    <Link
      href={`/members/${id}`}
      onClick={close}
      className={cn(buttonVariants({ variant: "outline" }), "h-10 md:h-8")}
    >
      {t("profile")}
    </Link>
  );
}
