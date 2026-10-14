"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Counters } from "@/components/layout/header-data";
import {
  entryIcon,
  isCurrent,
  type LinkItem,
  linkProps,
} from "@/components/layout/nav";

export function MobileNav({
  items,
  unread,
}: {
  items: LinkItem[];
  unread: Pick<Counters, "conversations" | "notifications">;
}) {
  const t = useTranslations("layout.mobileNav");
  const pathname = usePathname();
  const counts: Record<string, number> = {
    "mobile.messages": unread.conversations,
    "mobile.alerts": unread.notifications,
  };

  return (
    <nav
      aria-label={t("aria.primary")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <ul className="mx-auto grid h-14 max-w-lg auto-cols-fr grid-flow-col">
        {items.map((item) => {
          const Icon = entryIcon(item, true);
          const count = item.builtin ? counts[item.builtin] : 0;
          return (
            <li key={item.id}>
              <Link
                {...linkProps(item)}
                aria-current={isCurrent(pathname, item) ? "page" : undefined}
                className="flex h-full flex-col items-center justify-center gap-1 border-t-2 border-transparent text-(length:--text-caption) font-medium text-muted-foreground transition-colors aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {!!count && (
                    <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary ring-2 ring-background" />
                  )}
                </span>
                <span className="max-w-full truncate px-1">
                  {count
                    ? t.rich("unread", {
                        label: item.title,
                        count,
                        unread: (chunks) => (
                          <span className="sr-only">{chunks}</span>
                        ),
                      })
                    : item.title}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
