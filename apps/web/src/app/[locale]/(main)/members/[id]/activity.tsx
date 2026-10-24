import { MessagesSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  type ActivityKind,
  ActivityPages,
  activityAddress,
  activityPage,
  activityPages,
} from "@/app/[locale]/(main)/members/[id]/activity-page";
import { activityPageAction } from "@/app/[locale]/(main)/members/[id]/activity-page-action";
import type { Profile } from "@/app/[locale]/(main)/members/[id]/profile";
import { EmptyState } from "@/components/forum/empty-state";
import { PageSwitch } from "@/components/forum/page-switch";
import { pageAddress } from "@/components/forum/page-window";
import { UserLink } from "@/components/forum/user-link";

// A tab's list in numbered pages: a card with the heading only a screen reader sees and the rows,
// or the empty state.
export async function ActivityTab({
  tab,
  profile,
  page,
}: {
  tab: ActivityKind;
  profile: Profile;
  page: number;
}) {
  const [t, first] = await Promise.all([
    getTranslations("members.profile"),
    activityPage(tab, profile.id, page),
  ]);
  // A page past the last one goes to the last one, as XenForo does.
  const pages = activityPages(tab, first.total);
  if (page > pages) {
    const { path, params } = activityAddress(tab, profile.id);
    redirect(pageAddress(path, params, pages));
  }
  if (first.total === 0) {
    return (
      <section className="overflow-hidden rounded-lg border bg-card">
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
    <PageSwitch
      page={page}
      stamp={Date.now()}
      load={activityPageAction.bind(null, tab, profile.id)}
    >
      <ActivityPages kind={tab} userId={profile.id} page={page} list={first} />
    </PageSwitch>
  );
}
