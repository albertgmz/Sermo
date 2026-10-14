"use client";

import { UserCheck, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Follows or unfollows from where a member is drawn, without leaving the page. `action` asks for
// the opposite of what is shown and ends in a refresh; a refusal is shown under the button.
export function MemberFollowButton({
  username,
  following,
  action,
  className,
  labelClassName,
}: {
  username: string;
  following: boolean;
  action: () => Promise<{ error?: string }>;
  className?: string;
  // How the visible text is hidden where only the icon fits.
  labelClassName?: string;
}) {
  const t = useTranslations("members.wallButtons");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  return (
    <>
      <Button
        type="button"
        variant={following ? "outline" : "default"}
        disabled={pending}
        aria-label={t(following ? "aria.unfollow" : "aria.follow", {
          username,
        })}
        className={className}
        onClick={() =>
          start(async () => {
            setError((await action()).error);
          })
        }
      >
        {following ? <UserCheck /> : <UserPlus />}
        <span className={cn(labelClassName)}>
          {t(following ? "following" : "follow")}
        </span>
      </Button>
      {error && (
        <FormError className="max-w-36 text-xs [overflow-wrap:anywhere]">
          {error}
        </FormError>
      )}
    </>
  );
}
