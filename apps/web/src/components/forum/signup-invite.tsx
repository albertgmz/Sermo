import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InviteFrame } from "@/components/forum/invite-frame";
import { buttonVariants } from "@/components/ui/button";
import { loginHref } from "@/lib/join-window";
import { cn } from "@/lib/utils";

// An invitation to create an account drawn in the page, for a guest: what an account gives here and
// the ways in: "Log in", which comes back to `next`, and the main button, "Create account", while
// registration is open. `row` sits between the posts of a thread (their card is its frame); `card`
// stands on its own. A soft tint of the accent over the card's ground, and a stroke of it on the
// leading edge, set it apart from the posts around it. On a phone the buttons share a line under
// the text; from `sm` up they stand beside it.
export function SignupInvite({
  title,
  description,
  next,
  register,
  layout,
}: {
  title: string;
  description: string;
  next: string;
  register: boolean;
  layout: "row" | "card";
}) {
  const t = useTranslations("forum.signupInvite");
  return (
    <InviteFrame
      aria-label={title}
      className={cn(
        "relative flex flex-col gap-3 bg-[color-mix(in_oklab,var(--primary)_5%,var(--card))] p-4 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary sm:flex-row sm:items-center sm:gap-4 md:px-5",
        layout === "card" && "overflow-hidden rounded-lg border",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-ink"
        >
          <MessagesSquare className="size-5" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-balance">{title}</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <Link
          href={loginHref(next)}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-10 px-4 max-sm:flex-1",
          )}
        >
          {t("login")}
        </Link>
        {register && (
          <Link
            href="/register"
            className={cn(buttonVariants(), "h-10 px-4 max-sm:flex-1")}
          >
            {t("register")}
          </Link>
        )}
      </div>
    </InviteFrame>
  );
}
