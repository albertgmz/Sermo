"use client";

import { UserCheck, UserPlus } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { setFollowing } from "@/app/[locale]/(main)/members/actions";
import { FormError } from "@/components/forum/form-error";
import { PendingButton } from "@/components/forum/pending-button";

// Asks for the opposite of what the page shows; the backend has the last word. It goes back to the
// address the browser is at: the same tab of the profile, spelled the same way (another spelling
// of the profile would draw its header again, see `profileAddress`).
export function FollowButton({
  user,
  following,
  className,
}: {
  user: { id: number; username: string };
  following: boolean;
  className?: string;
}) {
  const t = useTranslations("members.wallButtons");
  const query = useSearchParams().toString();
  const returnTo = `${usePathname()}${query ? `?${query}` : ""}`;
  const [state, action] = useActionState(
    setFollowing.bind(null, user.id, returnTo),
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="following" value={String(!following)} />
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
      {state.error && (
        <FormError className="mt-1 text-xs">{state.error}</FormError>
      )}
    </form>
  );
}
