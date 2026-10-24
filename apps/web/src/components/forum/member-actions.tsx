import { followFromPage } from "@/app/[locale]/(main)/actions";
import {
  hasMemberActions,
  type MemberActionsForm,
  MemberActionsView,
} from "@/components/forum/member-actions-view";
import type { MemberRelation } from "@/lib/sermo/members";
import type { MemberView } from "@/lib/sermo/views";

export type { MemberActionsForm } from "@/components/forum/member-actions-view";

// What the viewer can do about a member, wherever the member is drawn: follow or unfollow (in
// place, the page is drawn again) and start a private conversation. The profile is reached by the
// avatar and the name, so there is no button for it.
export function MemberActions({
  member,
  relation,
  form,
}: {
  member: Pick<MemberView, "id" | "username" | "restricted">;
  relation: MemberRelation | null;
  form?: MemberActionsForm;
}) {
  return (
    <MemberActionsView
      member={member}
      relation={relation}
      form={form}
      followAction={followFromPage}
    />
  );
}

// The member card's actions, in one wrapping row: nothing at all (not an empty box) when there is
// nothing to offer.
export function memberActionsOf(
  member: Pick<MemberView, "id" | "username" | "restricted">,
  relation: MemberRelation | null,
): React.ReactNode {
  return hasMemberActions(member, relation) ? (
    <MemberActions member={member} relation={relation} form="row" />
  ) : undefined;
}
