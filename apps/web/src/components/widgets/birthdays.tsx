import { usersBirthdays } from "@sermo/core/contracts";
import { AvatarList } from "@/components/forum/avatar-list";
import { SectionCard } from "@/components/forum/section-card";
import {
  CardSkeleton,
  NewestMembersSkeleton,
} from "@/components/forum/skeletons";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";

// The members whose birthday is today, as avatars that open their cards. Nothing on a day without
// one, or for a viewer who may not list members.
export async function Birthdays({
  widget,
  title,
}: WidgetBodyProps<"birthdays">) {
  const list = await readIfAllowed(usersBirthdays, {});
  const members = list?.items.slice(0, widget.options.limit) ?? [];
  if (members.length === 0) return null;
  return (
    <SectionCard title={title}>
      <AvatarList members={members} />
    </SectionCard>
  );
}

export function BirthdaysSkeleton() {
  return (
    <CardSkeleton>
      <NewestMembersSkeleton />
    </CardSkeleton>
  );
}
