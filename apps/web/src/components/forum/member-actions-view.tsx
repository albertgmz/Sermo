import { Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  MemberFollowButton,
  MemberIgnoreButton,
} from "@/components/forum/member-follow-button";
import { buttonVariants } from "@/components/ui/button";
import type { MemberRelation } from "@/lib/sermo/members";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// `compact`: two 40px icon buttons (a phone header). `labelled`: icon and text (a column, a card).
// `responsive`: compact below `md`, labelled from `md` up, like the postbit around it.
// `row`: text on one line that wraps (the member's card).
export type MemberActionsForm = "compact" | "labelled" | "responsive" | "row";

export type FollowAction = (
  userId: number,
  follow: boolean,
) => Promise<{ error?: string; signIn?: string }>;
export type IgnoreAction = FollowAction;

const BUTTON: Record<MemberActionsForm, string> = {
  compact: "size-10 px-0",
  labelled: "h-10 md:h-8",
  responsive: "max-md:size-10 max-md:px-0 md:h-8",
  // Text only, as XenForo's tooltip buttons, so follow, ignore and the message fit one line.
  row: "h-10 px-3 md:h-8 [&_svg]:hidden",
};
const WRAPPER: Record<MemberActionsForm, string> = {
  compact: "flex items-center gap-1",
  labelled: "flex flex-col items-stretch gap-1.5",
  responsive: "flex items-center gap-1 md:flex-col md:items-stretch md:gap-1.5",
  row: "flex flex-wrap items-center gap-1.5",
};
const LABEL: Record<MemberActionsForm, string | undefined> = {
  compact: "sr-only",
  labelled: undefined,
  responsive: "max-md:sr-only",
  row: undefined,
};
// A refusal never widens the row of buttons: it hangs under it, right-aligned, inside the viewport.
const FLOATING =
  "absolute top-full right-0 z-10 mt-1 w-max max-w-[min(14rem,calc(100vw-2rem))] rounded-md border bg-card px-2 py-1 [overflow-wrap:anywhere]";
const ERROR: Record<MemberActionsForm, string> = {
  compact: FLOATING,
  labelled: "",
  responsive: `${FLOATING} md:static md:z-auto md:mt-0 md:w-auto md:max-w-none md:border-0 md:bg-transparent md:p-0`,
  row: FLOATING,
};

// Whether there is anything to offer for a member: a guest has no relation, and yourself, a
// restricted member and one nothing is allowed for draw nothing. Unfollowing and unignoring need
// no permission, so a member already followed or ignored can always be let go.
export function hasMemberActions(
  member: Pick<MemberView, "restricted">,
  relation: MemberRelation | null,
): relation is MemberRelation {
  return (
    relation !== null &&
    !member.restricted &&
    (relation.canFollow ||
      relation.following ||
      relation.canMessage ||
      relation.canIgnore ||
      relation.ignoring)
  );
}

// The actions with the writes they run handed in, so a styleguide can draw them with writes that
// store nothing. `MemberActions` is the one pages use. The order is XenForo's: follow, ignore,
// then the direct message.
export function MemberActionsView({
  member,
  relation,
  form = "responsive",
  followAction,
  ignoreAction,
}: {
  member: Pick<MemberView, "id" | "username" | "restricted">;
  relation: MemberRelation | null;
  form?: MemberActionsForm;
  followAction: FollowAction;
  ignoreAction: IgnoreAction;
}) {
  const t = useTranslations("forum.memberActions");
  if (!hasMemberActions(member, relation)) return null;
  const { id, username } = member;
  return (
    <div
      data-slot="member-actions"
      data-form={form}
      className={cn("relative", WRAPPER[form])}
    >
      {(relation.canFollow || relation.following) && (
        <MemberFollowButton
          userId={id}
          username={username}
          following={relation.following}
          action={followAction.bind(null, id)}
          className={BUTTON[form]}
          labelClassName={LABEL[form]}
          errorClassName={ERROR[form]}
        />
      )}
      {(relation.canIgnore || relation.ignoring) && (
        <MemberIgnoreButton
          userId={id}
          username={username}
          ignoring={relation.ignoring}
          action={ignoreAction.bind(null, id)}
          className={BUTTON[form]}
          labelClassName={LABEL[form]}
          errorClassName={ERROR[form]}
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
