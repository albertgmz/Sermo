import { MessagesSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  postsPage,
  threadsPage,
} from "@/app/[locale]/(main)/members/[id]/activity-page";
import { moreActivity } from "@/app/[locale]/(main)/members/[id]/more-activity";
import type { Profile } from "@/app/[locale]/(main)/members/[id]/profile";
import { EmptyState } from "@/components/forum/empty-state";
import { PagedList } from "@/components/forum/paged-list";
import { UserLink } from "@/components/forum/user-link";
import { pagesParam } from "@/lib/list-pages";

type Tab = "posts" | "threads";

// A tab's list: a card with the heading only a screen reader sees and the rows, or the empty state.
export async function ActivityTab({
  tab,
  profile,
  cursor,
  pages,
}: {
  tab: Tab;
  profile: Profile;
  cursor?: string;
  pages?: string | string[];
}) {
  const [t, loadMore, first] = await Promise.all([
    getTranslations("members.profile"),
    getTranslations("members.loadMore"),
    tab === "posts"
      ? postsPage(profile.id, cursor)
      : threadsPage(profile.id, cursor),
  ]);
  const card = "overflow-hidden rounded-lg border bg-card";
  if (first.rows.length === 0 && !first.nextCursor) {
    return (
      <section className={card}>
        <h2 className="sr-only">{t(`${tab}Tab`)}</h2>
        <EmptyState
          icon={MessagesSquare}
          title={t(`${tab}EmptyTitle`)}
          description={t.rich(`${tab}EmptyDescription`, {
            username: profile.username,
            user: () => <UserLink user={profile.card} />,
          })}
        />
      </section>
    );
  }
  return (
    <PagedList
      first={first}
      more={moreActivity.bind(null, tab, profile.id)}
      pages={pagesParam(pages)}
      start={cursor}
      listKey={["activity", tab, profile.id]}
      hrefBase={`/members/${profile.id}?tab=${tab}`}
      moreLabel={loadMore("label")}
      estimateSize={tab === "posts" ? 160 : 72}
      className={card}
      header={<h2 className="sr-only">{t(`${tab}Tab`)}</h2>}
      moreClassName="mt-3"
    />
  );
}
