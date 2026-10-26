"use client";

import { Ban, UserCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { FormError } from "@/components/forum/form-error";
import {
  holdMemberCards,
  useMemberCardReload,
} from "@/components/forum/member-card-scope";
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

// The dialog that asks before a block comes with the first press of the button.
const BlockDialog = lazy(() =>
  import("@/components/forum/block-dialog").then((module) => ({
    default: module.BlockDialog,
  })),
);

// Blocks or unblocks a member, in place, the same way as following, after the viewer confirms in
// a dialog that says what the change does.
export function MemberBlockButton(props: ToggleProps & { blocking: boolean }) {
  const t = useTranslations("forum.memberActions");
  return (
    <MemberToggle
      {...props}
      props={props}
      stateKey={`block:${props.userId}`}
      drawn={props.blocking}
      variant={() => "outline"}
      icon={() => <Ban />}
      label={(blocking) => t(blocking ? "unblock" : "block")}
      ariaLabel={(blocking) =>
        t(blocking ? "aria.unblock" : "aria.block", {
          username: props.username,
        })
      }
      asks
    />
  );
}

// One on/off control of the viewer about a member. `props` is the caller's own props object, which
// tells the store how old the drawn state is (`lib/item-state`). With `asks`, a press opens the
// block dialog (drawn from the first press on) and the change runs when the viewer confirms; while
// it is open, a member card it was opened from stays open, so the dialog is not taken with it.
function MemberToggle({
  username,
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
  asks,
}: ToggleProps & {
  props: object;
  stateKey: string;
  drawn: boolean;
  variant: (on: boolean) => "outline" | "default";
  icon: (on: boolean) => React.ReactNode;
  label: (on: boolean) => string;
  ariaLabel: (on: boolean) => string;
  asks?: boolean;
}) {
  const tFailed = useTranslations("lib.errors");
  const router = useRouter();
  const reloadCard = useMemberCardReload();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const on = useItemState(stateKey, drawn, props);
  const [asking, setAsking] = useState<boolean | null>(null);
  const release = useRef<(() => void) | null>(null);
  const ask = (open: boolean) => {
    setAsking(open);
    const held = release.current;
    release.current = open ? holdMemberCards() : null;
    // Let go of the card only once the gesture that closed the dialog is over: a later event of
    // it (the click after a touch) would close the card.
    if (held) setTimeout(held, 300);
  };
  useEffect(() => () => release.current?.(), []);
  const run = () =>
    start(async () => {
      const { error: refused, signIn } = await changeItem(
        stateKey,
        drawn,
        !on,
        () => {
          // A change keeps its card open until it is answered, so a refusal shows.
          const busy = holdMemberCards();
          return action(!on).finally(busy);
        },
        tFailed("generic"),
      );
      if (signIn) {
        router.push(signIn);
        return;
      }
      setError(refused);
      // Inside a member card the page's refresh does not reach the card: read it again.
      if (!refused) reloadCard();
    });
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
        onClick={() => (asks ? ask(true) : run())}
      >
        {icon(on)}
        <span className={cn(labelClassName)}>{label(on)}</span>
      </Button>
      {error && (
        <FormError className={cn("text-xs", errorClassName)}>{error}</FormError>
      )}
      {asking !== null && (
        <Suspense>
          <BlockDialog
            open={asking}
            onOpenChange={ask}
            username={username}
            blocking={on}
            onConfirm={run}
          />
        </Suspense>
      )}
    </>
  );
}
