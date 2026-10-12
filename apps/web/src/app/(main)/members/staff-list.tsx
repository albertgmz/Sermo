import { MemberRow } from "@/components/forum/member-row";
import type { MemberView } from "@/lib/sermo/views";

// What a staff member's row says about them: the staff groups they belong to.
export function staffUser(member: {
  card: MemberView;
  groups: string[];
}): MemberView {
  return {
    ...member.card,
    title: member.groups.join(" · ") || member.card.title,
  };
}

export function StaffList({
  staff,
}: {
  staff: { card: MemberView; groups: string[] }[];
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
      {staff.map((member) => (
        <MemberRow
          key={member.card.id}
          user={staffUser(member)}
          badgeLimit={1}
        />
      ))}
    </div>
  );
}
