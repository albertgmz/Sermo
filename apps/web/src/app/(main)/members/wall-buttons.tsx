import { UserCheck, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { followMember } from "@/app/(main)/members/actions";
import { PendingButton } from "@/components/forum/pending-button";
import type { UserView } from "@/lib/db";

export function FollowButton({
  user,
  viewer,
  following,
  className,
}: {
  user: Pick<UserView, "id" | "username">;
  viewer: Pick<UserView, "id"> | null;
  following: boolean;
  className?: string;
}) {
  const t = useTranslations("members.wallButtons");
  if (!viewer) return null;
  return (
    <form action={followMember.bind(null, user.id)}>
      <PendingButton
        variant={following ? "outline" : "default"}
        aria-label={t(following ? "aria.unfollow" : "aria.follow", {
          username: user.username,
        })}
        className={className}
      >
        {following ? <UserCheck /> : <UserPlus />}
        {t(following ? "following" : "follow")}
      </PendingButton>
    </form>
  );
}
