"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CreateButton } from "@/components/layout/create-button";
import type { Counters } from "@/components/layout/header-data";
import {
  iconFor,
  isCurrent,
  type LinkItem,
  linkProps,
} from "@/components/layout/nav";
import { useCounter } from "@/lib/counters";

// The round + that opens the Create dialog sits in the middle of the bar; a guest's leads to sign-in.
export function MobileNav(props: {
  items: LinkItem[];
  unread: Pick<Counters, "conversations" | "notifications">;
  member: boolean;
}) {
  const { items, unread, member } = props;
  const middle = Math.ceil(items.length / 2);
  const t = useTranslations("layout.mobileNav");
  const pathname = usePathname();
  const counts: Record<string, number> = {
    "mobile.messages": useCounter("conversations", unread.conversations, props),
    "mobile.alerts": useCounter("notifications", unread.notifications, props),
  };

  const create = (
    <li key="create" className="flex items-center justify-center">
      <CreateButton variant="bar" member={member} />
    </li>
  );

  return (
    <nav
      aria-label={t("aria.primary")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <ul className="mx-auto grid h-14 max-w-lg auto-cols-fr grid-flow-col">
        {items.flatMap((item, index) => {
          const Icon = iconFor(item.builtin);
          const count = item.builtin ? counts[item.builtin] : 0;
          const entry = (
            <li key={item.id}>
              <Link
                {...linkProps(item)}
                aria-current={isCurrent(pathname, item) ? "page" : undefined}
                className="flex h-full flex-col items-center justify-center gap-1 border-t-2 border-transparent text-(length:--text-caption) font-medium text-muted-foreground transition-colors aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
              >
                <span className="relative">
                  {item.iconNode ? (
                    <span
                      aria-hidden="true"
                      className="inline-flex size-5 [&>svg]:size-full"
                    >
                      {item.iconNode}
                    </span>
                  ) : (
                    <Icon className="size-5" />
                  )}
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
          return index === middle ? [create, entry] : [entry];
        })}
        {middle >= items.length && create}
      </ul>
    </nav>
  );
}
