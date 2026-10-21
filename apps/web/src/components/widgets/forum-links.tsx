import { nodesList } from "@sermo/core/contracts";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ForumIcon } from "@/components/forum/forum-icon";
import { SectionCard } from "@/components/forum/section-card";
import { CardSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { formatCompact } from "@/lib/format";
import { readIfAllowed } from "@/lib/sermo/client";

const viewAllClass =
  "relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground";

// The first forums of the list, each with its thread count, and a link to the whole list.
export async function ForumLinks({
  widget,
  title,
}: WidgetBodyProps<"forumLinks">) {
  const nodes = await readIfAllowed(nodesList, {});
  const forums = (nodes?.items ?? []).filter((node) => node.type === "forum");
  if (forums.length === 0) return null;
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("widgets.forumLinks"),
  ]);
  return (
    <SectionCard
      title={title}
      action={
        <Link href="/" className={viewAllClass}>
          {t("viewAll")}
        </Link>
      }
    >
      {forums.slice(0, widget.options.limit).map((forum) => (
        <Link
          key={forum.id}
          href={`/forums/${forum.id}`}
          className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/30"
        >
          <ForumIcon
            name={forum.iconKey ?? ""}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {forum.title}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t.rich("threads", {
              count: forum.threadCount,
              value: formatCompact(forum.threadCount, locale),
              label: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </span>
        </Link>
      ))}
    </SectionCard>
  );
}

export function ForumLinksSkeleton({
  widget,
}: {
  widget: WidgetBodyProps<"forumLinks">["widget"];
}) {
  return (
    <CardSkeleton>
      {Array.from(
        { length: widget.options.limit },
        (_, index) => `row-${index}`,
      ).map((key) => (
        <div key={key} className="flex h-11 items-center gap-3 px-4">
          <Skeleton className="size-4" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ))}
    </CardSkeleton>
  );
}
