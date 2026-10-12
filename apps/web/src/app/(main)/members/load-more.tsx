import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The next page of a list: a link, so it works without scripts and the page stays a page.
export function LoadMore({ href }: { href: string }) {
  const t = useTranslations("members.loadMore");
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}
    >
      <ChevronDown />
      {t("label")}
    </Link>
  );
}
