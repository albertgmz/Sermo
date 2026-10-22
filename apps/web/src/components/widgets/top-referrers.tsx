import { usersList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { Leaderboard } from "@/components/forum/leaderboard";
import { SectionCard } from "@/components/forum/section-card";
import { MemberListSkeleton } from "@/components/forum/skeletons";
import { ViewAllLink } from "@/components/widgets/view-all-link";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

// The members who have invited the most, all time. A member nobody has joined through is not ranked.
export async function TopReferrers({
  widget,
  title,
}: WidgetBodyProps<"topReferrers">) {
  const { limit } = widget.options;
  const [{ user }, list] = await Promise.all([
    getViewer(),
    readIfAllowed(usersList, { sort: "referrals", limit }),
  ]);
  const members = list?.items.filter((item) => item.referralCount > 0) ?? [];
  if (members.length === 0) return null;
  const t = await getTranslations("widgetTypes.topReferrers");
  return (
    <SectionCard
      title={title}
      action={
        <ViewAllLink href="/members?view=referrals">{t("viewAll")}</ViewAllLink>
      }
    >
      <Leaderboard
        members={members}
        by="referrals"
        viewerId={user?.id}
        compact
      />
    </SectionCard>
  );
}

export function TopReferrersSkeleton({
  widget,
}: {
  widget: WidgetBodyProps<"topReferrers">["widget"];
}) {
  return <MemberListSkeleton rows={widget.options.limit} />;
}
