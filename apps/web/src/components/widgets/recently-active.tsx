import { usersRecentlyActive } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { SectionCard } from "@/components/forum/section-card";
import { CardSkeleton, TextSkeleton } from "@/components/forum/skeletons";
import { UserLink } from "@/components/forum/user-link";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";

// How long ago a member was last seen to count as online now (the "15m" window).
const ONLINE_NOW_MS = 15 * 60_000;

// The members seen lately who show their online status, names only, and how many there are. The
// backend leaves out those who hide it and gives every visitor the same list, so what is drawn
// needs no check of its own. Nothing for a visitor who may not list members, or when no one is
// there.
export async function RecentlyActive({
  widget,
  title,
}: WidgetBodyProps<"recentlyActive">) {
  const list = await readIfAllowed(usersRecentlyActive, {});
  if (!list) return null;
  const since = Date.now() - ONLINE_NOW_MS;
  // The 24 hours are what the backend counts; the shorter window counts the members it lists.
  const now = widget.options.window === "15m";
  const members = now
    ? list.items.filter((item) => Date.parse(item.lastActivityAt) >= since)
    : list.items;
  if (members.length === 0) return null;
  const [t, format] = await Promise.all([
    getTranslations("widgets.recentlyActive"),
    getFormatter(),
  ]);
  const total = now ? members.length : list.total;
  // The first names only (each is a hover card); the others are counted.
  const named = members.slice(0, widget.options.limit);
  const more = total - named.length;
  return (
    <SectionCard
      title={
        <Link href="/members" className="hover:underline">
          {widget.title ?? (now ? t("nowTitle") : title)}
        </Link>
      }
    >
      <ul className="flex flex-wrap gap-x-1 px-4 py-1.5 text-sm">
        {named.map(({ card }, index) => (
          <li key={card.id} className="flex">
            <UserLink user={card} className="block py-2.5" />
            {(index < named.length - 1 || more > 0) && (
              <span aria-hidden="true" className="py-2.5">
                ,
              </span>
            )}
          </li>
        ))}
        {more > 0 && (
          <li className="py-2.5 text-muted-foreground">
            {t("more", { value: format.number(more) })}
          </li>
        )}
      </ul>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {t("total", { value: format.number(total) })}
      </p>
    </SectionCard>
  );
}

export function RecentlyActiveSkeleton() {
  return (
    <CardSkeleton>
      <div className="px-4 py-3">
        <TextSkeleton />
      </div>
    </CardSkeleton>
  );
}
