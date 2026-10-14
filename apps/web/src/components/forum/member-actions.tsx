import { Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { followFromPage } from "@/app/(main)/actions";
import { MemberFollowButton } from "@/components/forum/member-follow-button";
import { buttonVariants } from "@/components/ui/button";
import type { MemberRelation } from "@/lib/sermo/members";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// `compact`: two 40px icon buttons (a phone header). `labelled`: icon and text (a column, a card).
// `responsive`: compact below `md`, labelled from `md` up, like the postbit around it.
export type MemberActionsForm = "compact" | "labelled" | "responsive";

const BUTTON: Record<MemberActionsForm, string> = {
  compact: "size-10 px-0",
  labelled: "h-10 md:h-8",
  responsive: "max-md:size-10 max-md:px-0 md:h-8",
};
const WRAPPER: Record<MemberActionsForm, string> = {
  compact: "flex items-center gap-1",
  labelled: "flex flex-col items-stretch gap-1.5",
  responsive: "flex items-center gap-1 md:flex-col md:items-stretch md:gap-1.5",
};
const LABEL: Record<MemberActionsForm, string | undefined> = {
  compact: "sr-only",
  labelled: undefined,
  responsive: "max-md:sr-only",
};

// Whether there is anything to offer for a member: a guest has no relation, and yourself, a
// restricted member and one nothing is allowed for draw nothing.
export function hasMemberActions(
  member: Pick<MemberView, "restricted">,
  relation: MemberRelation | null,
): relation is MemberRelation {
  return (
    relation !== null &&
    !member.restricted &&
    (relation.canFollow || relation.canMessage)
  );
}

// What the viewer can do about a member, wherever the member is drawn: follow or unfollow (in
// place, the page is drawn again) and start a private conversation. The profile is reached by the
// avatar and the name, so there is no button for it.
export function MemberActions({
  member,
  relation,
  form = "responsive",
  className,
}: {
  member: Pick<MemberView, "id" | "username" | "restricted">;
  relation: MemberRelation | null;
  form?: MemberActionsForm;
  className?: string;
}) {
  const t = useTranslations("forum.memberActions");
  if (!hasMemberActions(member, relation)) return null;
  const { id, username } = member;
  return (
    <div
      data-slot="member-actions"
      data-form={form}
      className={cn(WRAPPER[form], className)}
    >
      {relation.canFollow && (
        <MemberFollowButton
          username={username}
          following={relation.following}
          action={followFromPage.bind(null, id, !relation.following)}
          className={BUTTON[form]}
          labelClassName={LABEL[form]}
        />
      )}
      {relation.canMessage && (
        <Link
          href={`/conversations/new?to=${encodeURIComponent(username)}`}
          aria-label={t("aria.message", { username })}
          className={cn(buttonVariants({ variant: "outline" }), BUTTON[form])}
        >
          <Mail />
          <span className={LABEL[form]}>{t("message")}</span>
        </Link>
      )}
    </div>
  );
}

// The postbit's actions for a page of posts: nothing at all (not an empty box) when there is
// nothing to offer, so the column keeps its spacing.
export function memberActionsOf(
  member: Pick<MemberView, "id" | "username" | "restricted">,
  relation: MemberRelation | null,
): React.ReactNode {
  return hasMemberActions(member, relation) ? (
    <MemberActions member={member} relation={relation} />
  ) : undefined;
}
