"use client";

import {
  type MemberActionsForm,
  MemberActionsView,
} from "@/components/forum/member-actions-view";
import type { MemberRelation } from "@/lib/sermo/members";
import type { MemberView } from "@/lib/sermo/views";

// The shared member actions with their backend left out: following and blocking store nothing.
export function MemberActionsDemo({
  member,
  relation,
  form,
}: {
  member: Pick<MemberView, "id" | "username" | "restricted">;
  relation: MemberRelation;
  form?: MemberActionsForm;
}) {
  return (
    <MemberActionsView
      member={member}
      relation={relation}
      form={form}
      followAction={async () => ({})}
      blockAction={async () => ({})}
    />
  );
}
