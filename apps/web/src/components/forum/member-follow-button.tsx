"use client";

import { UserCheck, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forum/form-error";
import { useMemberCardReload } from "@/components/forum/member-card-scope";
import { Button } from "@/components/ui/button";
import { changeItem, useItemState } from "@/lib/item-state";
import { cn } from "@/lib/utils";

// Follows or unfollows from where a member is drawn, without leaving the page. `action` is asked
// for the opposite of what is shown, which shows at once (on every button of that member) and is
// put back when the backend refuses; the refusal is shown under the button.
export function MemberFollowButton({
  userId,
  username,
  following: drawn,
  action,
  className,
  labelClassName,
  errorClassName,
}: {
  userId: number;
  username: string;
  following: boolean;
  action: (follow: boolean) => Promise<{ error?: string }>;
  className?: string;
  // How the visible text is hidden where only the icon fits.
  labelClassName?: string;
  // Where a refusal is drawn.
  errorClassName?: string;
}) {
  const t = useTranslations("members.wallButtons");
  const reloadCard = useMemberCardReload();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const stateKey = `follow:${userId}`;
  const following = useItemState(stateKey, drawn);
  return (
    <>
      <Button
        type="button"
        variant={following ? "outline" : "default"}
        // Kept focusable while the write runs: a disabled button hands its focus to the page.
        disabled={pending}
        focusableWhenDisabled
        aria-label={t(following ? "aria.unfollow" : "aria.follow", {
          username,
        })}
        className={cn("aria-disabled:opacity-50", className)}
        onClick={() =>
          start(async () => {
            const refused = await changeItem(stateKey, drawn, !following, () =>
              action(!following),
            );
            setError(refused);
            // Inside a member card the page's refresh does not reach the card: read it again.
            if (!refused) reloadCard();
          })
        }
      >
        {following ? <UserCheck /> : <UserPlus />}
        <span className={cn(labelClassName)}>
          {t(following ? "following" : "follow")}
        </span>
      </Button>
      {error && (
        <FormError className={cn("text-xs", errorClassName)}>{error}</FormError>
      )}
    </>
  );
}
