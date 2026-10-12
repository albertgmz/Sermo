"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { type DetailsState, saveDetails } from "@/app/(main)/account/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TITLE_MAX_LENGTH, USERNAME_PATTERN } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const USERNAME_ERRORS = {
  not_found: "errors.usernameNotFound",
  not_allowed: "errors.usernameNotAllowed",
  invalid: "errors.usernameInvalid",
  taken: "errors.usernameTaken",
  unconfirmed: "errors.usernameUnconfirmed",
} as const;

const TITLE_ERRORS = {
  not_found: "errors.titleNotFound",
  not_allowed: "errors.titleNotAllowed",
  too_long: "errors.titleTooLong",
} as const;

const rowClass = "grid gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6";
const linkClass =
  "inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline";

export function DetailsForm({
  username,
  title,
  canChangeUsername,
  canChangeTitle,
  usernameChanges,
  saved,
}: {
  username: string;
  title: string;
  canChangeUsername: boolean;
  canChangeTitle: boolean;
  usernameChanges: number | null;
  saved: boolean;
}) {
  const t = useTranslations("account.accountDetailsForm");
  const [state, action, pending] = useActionState<DetailsState, FormData>(
    saveDetails,
    null,
  );
  const [value, setValue] = useState(username);
  const [titleValue, setTitleValue] = useState(title);
  const next = value.trim();
  const usernameChanged = next !== username;
  const error = state
    ? state.field === "username"
      ? t(USERNAME_ERRORS[state.error])
      : t(TITLE_ERRORS[state.error], { count: TITLE_MAX_LENGTH })
    : undefined;

  return (
    <form action={action}>
      <div className="divide-y">
        <div id="username" className={rowClass}>
          <Label htmlFor="account-username" className="self-start sm:pt-3">
            {t("usernameLabel")}
          </Label>
          <div className="min-w-0 space-y-2">
            <Input
              id="account-username"
              name="username"
              autoComplete="username"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={!canChangeUsername || pending}
              maxLength={20}
              aria-describedby="username-rules"
              aria-invalid={state?.field === "username" || undefined}
            />
            <p id="username-rules" className="text-xs text-muted-foreground">
              {canChangeUsername
                ? usernameChanges === null
                  ? t("usernameStaffRules")
                  : t("changes", { count: usernameChanges })
                : t.rich("usernameLockedRules", {
                    shop: (chunks) => (
                      <Link
                        href="/credits?category=permission#permission-usernameChange"
                        className={linkClass}
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
            </p>
            {canChangeUsername && usernameChanged && (
              <div className="flex min-h-10 items-start gap-3 py-2">
                <Checkbox id="username-confirm" name="confirm" value="on" />
                <Label
                  htmlFor="username-confirm"
                  className="block leading-normal font-normal text-muted-foreground [overflow-wrap:anywhere]"
                >
                  {t("confirmation", {
                    username: USERNAME_PATTERN.test(next)
                      ? next
                      : t("usernameFallback"),
                  })}
                </Label>
              </div>
            )}
          </div>
        </div>
        <div id="title" className={rowClass}>
          <Label htmlFor="account-title" className="self-start sm:pt-3">
            {t("titleLabel")}
          </Label>
          <div className="min-w-0 space-y-2">
            <Input
              id="account-title"
              name="title"
              value={titleValue}
              onChange={(event) => setTitleValue(event.target.value)}
              disabled={!canChangeTitle || pending}
              maxLength={TITLE_MAX_LENGTH}
              placeholder={t("titlePlaceholder")}
              aria-describedby="title-rules"
              aria-invalid={state?.field === "title" || undefined}
            />
            <p id="title-rules" className="text-xs text-muted-foreground">
              {t.rich("titleRules", {
                count: TITLE_MAX_LENGTH,
                access: canChangeTitle ? "unlocked" : "locked",
                shop: (chunks) => (
                  <Link
                    href="/credits?category=permission#permission-customTitle"
                    className={linkClass}
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t p-4">
        <PendingButton
          disabled={!canChangeUsername && !canChangeTitle}
          className="min-h-10 px-4"
        >
          {pending ? t("pending") : t("submit")}
        </PendingButton>
        <output
          className={cn(
            "text-xs font-medium empty:hidden",
            error ? "text-destructive" : "text-success",
          )}
        >
          {state?.field === "title" && state.usernameSaved
            ? t("partialSaveError", { error: error ?? "" })
            : (error ?? (!pending && saved ? t("saved") : ""))}
        </output>
      </div>
    </form>
  );
}
