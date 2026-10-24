"use client";

import { Ban, UserCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forum/form-error";
import { useMemberCardReload } from "@/components/forum/member-card-scope";
import { Button } from "@/components/ui/button";
import { changeItem, useItemState } from "@/lib/item-state";
import { cn } from "@/lib/utils";

type ToggleProps = {
  userId: number;
  username: string;
  action: (on: boolean) => Promise<{ error?: string; signIn?: string }>;
  className?: string;
  // How the visible text is hidden where only the icon fits.
  labelClassName?: string;
  // Where a refusal is drawn.
  errorClassName?: string;
};

// Follows or unfollows from where a member is drawn, without leaving the page. `action` is asked
// for the opposite of what is shown, which shows at once (on every button of that member) and is
// put back when the backend refuses; the refusal is shown under the button.
export function MemberFollowButton(
  props: ToggleProps & { following: boolean },
) {
  const t = useTranslations("members.wallButtons");
  return (
    <MemberToggle
      {...props}
      props={props}
      stateKey={`follow:${props.userId}`}
      drawn={props.following}
      variant={(following) => (following ? "outline" : "default")}
      icon={(following) => (following ? <UserCheck /> : <UserPlus />)}
      label={(following) => t(following ? "following" : "follow")}
      ariaLabel={(following) =>
        t(following ? "aria.unfollow" : "aria.follow", {
          username: props.username,
        })
      }
    />
  );
}

// Ignores or stops ignoring a member, in place, the same way as following.
export function MemberIgnoreButton(props: ToggleProps & { ignoring: boolean }) {
  const t = useTranslations("forum.memberActions");
  return (
    <MemberToggle
      {...props}
      props={props}
      stateKey={`ignore:${props.userId}`}
      drawn={props.ignoring}
      variant={() => "outline"}
      icon={() => <Ban />}
      label={(ignoring) => t(ignoring ? "unignore" : "ignore")}
      ariaLabel={(ignoring) =>
        t(ignoring ? "aria.unignore" : "aria.ignore", {
          username: props.username,
        })
      }
    />
  );
}

// One on/off control of the viewer about a member. `props` is the caller's own props object, which
// tells the store how old the drawn state is (`lib/item-state`).
function MemberToggle({
  action,
  className,
  labelClassName,
  errorClassName,
  props,
  stateKey,
  drawn,
  variant,
  icon,
  label,
  ariaLabel,
}: ToggleProps & {
  props: object;
  stateKey: string;
  drawn: boolean;
  variant: (on: boolean) => "outline" | "default";
  icon: (on: boolean) => React.ReactNode;
  label: (on: boolean) => string;
  ariaLabel: (on: boolean) => string;
}) {
  const tFailed = useTranslations("lib.errors");
  const router = useRouter();
  const reloadCard = useMemberCardReload();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const on = useItemState(stateKey, drawn, props);
  return (
    <>
      <Button
        type="button"
        variant={variant(on)}
        // Kept focusable while the write runs: a disabled button hands its focus to the page.
        disabled={pending}
        focusableWhenDisabled
        aria-label={ariaLabel(on)}
        className={cn("aria-disabled:opacity-50", className)}
        onClick={() =>
          start(async () => {
            const { error: refused, signIn } = await changeItem(
              stateKey,
              drawn,
              !on,
              () => action(!on),
              tFailed("generic"),
            );
            if (signIn) {
              router.push(signIn);
              return;
            }
            setError(refused);
            // Inside a member card the page's refresh does not reach the card: read it again.
            if (!refused) reloadCard();
          })
        }
      >
        {icon(on)}
        <span className={cn(labelClassName)}>{label(on)}</span>
      </Button>
      {error && (
        <FormError className={cn("text-xs", errorClassName)}>{error}</FormError>
      )}
    </>
  );
}
