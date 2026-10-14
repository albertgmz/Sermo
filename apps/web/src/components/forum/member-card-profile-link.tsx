import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The way from a member's card to their full profile.
export function MemberCardProfileLink({ id }: { id: number }) {
  const t = useTranslations("forum.memberCard");
  return (
    <Link
      href={`/members/${id}`}
      className={cn(buttonVariants({ variant: "outline" }), "h-10 md:h-8")}
    >
      {t("profile")}
    </Link>
  );
}
