import { UserCheck, UserPlus } from "lucide-react";
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
  if (!viewer) return null;
  return (
    <form action={followMember.bind(null, user.id)}>
      <PendingButton
        variant={following ? "outline" : "default"}
        aria-label={`${following ? "Unfollow" : "Follow"} ${user.username}`}
        className={className}
      >
        {following ? <UserCheck /> : <UserPlus />}
        {following ? "Following" : "Follow"}
      </PendingButton>
    </form>
  );
}
