import { nodesList, threadPrefixesList } from "@sermo/core/contracts";
import { X } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FeedFiltersButton } from "@/components/forum/feed-filters-button";
import {
  type FeedFilterValue,
  feedHref,
  isFiltered,
  without,
} from "@/lib/feed-filters";
import type { HomeTab } from "@/lib/home-tabs";
import { read } from "@/lib/sermo/client";

const chipClass =
  "inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border bg-card pr-2 pl-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-8";

// The row above the feed: the button that opens the filters, and one chip for each field that is
// on, which takes that field off. Forum and prefix names are read only when the filter has them.
export async function FeedFilterBar({
  tab,
  filter,
}: {
  tab: HomeTab;
  filter: FeedFilterValue;
}) {
  const t = await getTranslations("forum.feedFilterBar");
  const [nodes, prefixes] = await Promise.all([
    filter.forumIds ? read(nodesList, {}) : null,
    filter.prefixId !== undefined ? read(threadPrefixesList, {}) : null,
  ]);
  const chips: { key: string; label: string; href: string }[] = [];
  for (const id of filter.forumIds ?? []) {
    const title = nodes?.items.find((node) => node.id === id)?.title;
    chips.push({
      key: `forum-${id}`,
      label: title ? t("forum", { title }) : t("forumUnknown"),
      href: feedHref(tab, without(filter, "forumIds", id)),
    });
  }
  if (filter.prefixId !== undefined) {
    const label = prefixes?.items.find(
      (prefix) => prefix.id === filter.prefixId,
    )?.label;
    chips.push({
      key: "prefix",
      label: label ? t("prefix", { label }) : t("prefixUnknown"),
      href: feedHref(tab, without(filter, "prefixId")),
    });
  }
  if (filter.type)
    chips.push({
      key: "type",
      label: t(`types.${filter.type}`),
      href: feedHref(tab, without(filter, "type")),
    });
  if (filter.tag)
    chips.push({
      key: "tag",
      label: t("tag", { tag: filter.tag }),
      href: feedHref(tab, without(filter, "tag")),
    });
  if (filter.watched)
    chips.push({
      key: "watched",
      label: t("watched"),
      href: feedHref(tab, without(filter, "watched")),
    });
  if (filter.unread)
    chips.push({
      key: "unread",
      label: t("unread"),
      href: feedHref(tab, without(filter, "unread")),
    });
  return (
    <section
      aria-label={t("aria.filters")}
      className="flex flex-wrap items-center gap-2"
    >
      <FeedFiltersButton tab={tab} filter={filter} count={chips.length} />
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          aria-label={t("aria.remove", { label: chip.label })}
          className={chipClass}
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <X aria-hidden="true" className="size-3.5 shrink-0" />
        </Link>
      ))}
      {isFiltered(filter) && (
        <Link
          href={feedHref(tab)}
          className="inline-flex min-h-10 items-center px-1 text-sm text-primary-ink underline-offset-4 hover:underline"
        >
          {t("clear")}
        </Link>
      )}
    </section>
  );
}
