import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  VIEWS,
  type ViewValue,
  viewHref,
} from "@/app/[locale]/(main)/members/views";
import { cn } from "@/lib/utils";

const VARIANTS = {
  list: {
    nav: "grid gap-0.5 rounded-lg border bg-card p-2",
    link: "min-h-10 gap-2.5 rounded-md px-3 hover:bg-muted/50 aria-[current=page]:bg-muted",
  },
  chips: {
    nav: "-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]",
    link: "h-10 shrink-0 gap-1.5 rounded-full border bg-card px-3.5 aria-[current=page]:border-primary/50 aria-[current=page]:bg-primary/10",
  },
};

export function MembersNav({
  active,
  variant,
  className,
}: {
  active: ViewValue;
  variant: keyof typeof VARIANTS;
  className?: string;
}) {
  const t = useTranslations("members.membersNav");
  const views = useTranslations("members.views");
  return (
    <nav
      aria-label={t("aria.views")}
      className={cn(VARIANTS[variant].nav, className)}
    >
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <Link
          key={value}
          href={viewHref(value)}
          aria-current={value === active ? "page" : undefined}
          className={cn(
            "group inline-flex items-center text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground",
            VARIANTS[variant].link,
          )}
        >
          <Icon
            aria-hidden="true"
            className="size-4 shrink-0 group-aria-[current=page]:text-primary"
          />
          {views(label)}
        </Link>
      ))}
    </nav>
  );
}
