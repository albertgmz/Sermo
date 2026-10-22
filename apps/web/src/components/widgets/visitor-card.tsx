import { getLocale, getTranslations } from "next-intl/server";
import { MemberRowSkeleton } from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { Skeleton } from "@/components/ui/skeleton";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { formatNumber } from "@/lib/format";
import { authorsFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";

// The signed-in visitor's own card: picture, name, title and their counts. Nothing for a guest.
export async function VisitorCard({ title }: WidgetBodyProps<"visitorCard">) {
  const { user } = await getViewer();
  if (!user) return null;
  const [author, locale, t] = await Promise.all([
    authorsFor([user]),
    getLocale(),
    getTranslations("widgetTypes.visitorCard"),
  ]);
  const { member, postCount, reactionScore } = author(user.id);
  const counts = [
    { key: "posts", label: t("posts"), value: postCount },
    { key: "reactions", label: t("reactions"), value: reactionScore },
  ];
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="flex items-center gap-3 p-4">
        <UserAvatar user={member} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2">
            <UserLink
              user={member}
              className="-my-2.5 max-w-full truncate py-2.5 text-base"
            />
            <UserBadges user={member} limit={1} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {member.title}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 divide-x divide-border border-t text-center">
        {counts.map(({ key, label, value }) => (
          <div key={key} className="px-2 py-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {formatNumber(value, locale)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function VisitorCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <MemberRowSkeleton className="p-4" />
      <div className="grid grid-cols-2 divide-x divide-border border-t">
        {[1, 2].map((count) => (
          <div
            key={count}
            className="flex flex-col items-center gap-1.5 py-2.5"
          >
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
