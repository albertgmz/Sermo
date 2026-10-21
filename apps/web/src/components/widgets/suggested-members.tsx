import { usersList } from "@sermo/core/contracts";
import { followFromPage } from "@/app/[locale]/(main)/actions";
import { MemberFollowButton } from "@/components/forum/member-follow-button";
import { MemberRow } from "@/components/forum/member-row";
import { SectionCard } from "@/components/forum/section-card";
import { MemberListSkeleton } from "@/components/forum/skeletons";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";
import { relationsFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";

// How many members are asked for at the least, so that the viewer can be left out.
const CANDIDATES = 12;

// The most reacted-to members, without the viewer. The members they follow already are not left
// out: the button says "Following" for them. Nothing for a viewer who may not list members.
export async function SuggestedMembers({
  widget,
  title,
}: WidgetBodyProps<"suggestedMembers">) {
  const { limit } = widget.options;
  const [{ user }, list] = await Promise.all([
    getViewer(),
    readIfAllowed(usersList, {
      sort: "reactions",
      limit: Math.max(CANDIDATES, limit + 1),
    }),
  ]);
  if (!list) return null;
  const suggestions = list.items
    .filter(({ card }) => card.id !== user?.id)
    .slice(0, limit);
  if (suggestions.length === 0) return null;
  const relation = await relationsFor(
    user?.id ?? null,
    suggestions.map(({ card }) => card.id),
  );
  return (
    <SectionCard title={title}>
      {suggestions.map(({ card }) => (
        <MemberRow key={card.id} user={card} badgeLimit={1}>
          {user && (
            <MemberFollowButton
              userId={card.id}
              username={card.username}
              following={relation(card.id)?.following ?? false}
              action={followFromPage.bind(null, card.id)}
              className="h-10 md:h-8"
            />
          )}
        </MemberRow>
      ))}
    </SectionCard>
  );
}

export function SuggestedMembersSkeleton({
  widget,
}: {
  widget: WidgetBodyProps<"suggestedMembers">["widget"];
}) {
  return <MemberListSkeleton rows={widget.options.limit} />;
}
