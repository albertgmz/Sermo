"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { type DetailsState, saveDetails } from "@/app/(main)/account/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TITLE_MAX_LENGTH, USERNAME_PATTERN } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const USERNAME_ERRORS = {
  not_found: "Your account was not found.",
  not_allowed: "You have no username change left.",
  invalid: "Use 3 to 20 letters, numbers, underscores or hyphens.",
  taken: "That username is already taken.",
  unconfirmed: "Confirm your username change.",
};

const TITLE_ERRORS = {
  not_found: "Your account was not found.",
  not_allowed: "You need the custom title permission for that.",
  too_long: `A title holds at most ${TITLE_MAX_LENGTH} characters.`,
};

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
      ? USERNAME_ERRORS[state.error]
      : TITLE_ERRORS[state.error]
    : undefined;

  return (
    <form action={action}>
      <div className="divide-y">
        <div id="username" className={rowClass}>
          <Label htmlFor="account-username" className="self-start sm:pt-3">
            Username
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
              3 to 20 characters: letters, numbers, underscores and hyphens.
              {canChangeUsername &&
                (usernameChanges === null
                  ? " Staff can change their username freely."
                  : ` You have ${usernameChanges} ${usernameChanges === 1 ? "change" : "changes"} available. Each change uses one.`)}
              {!canChangeUsername && (
                <>
                  {" "}
                  <Link
                    href="/credits?category=permission#permission-usernameChange"
                    className={linkClass}
                  >
                    Get a username change in the shop
                  </Link>
                </>
              )}
            </p>
            {canChangeUsername && usernameChanged && (
              <div className="flex min-h-10 items-start gap-3 py-2">
                <Checkbox id="username-confirm" name="confirm" value="on" />
                <Label
                  htmlFor="username-confirm"
                  className="block leading-normal font-normal text-muted-foreground [overflow-wrap:anywhere]"
                >
                  I want to change my username to{" "}
                  {USERNAME_PATTERN.test(next) ? next : "my new username"}. My
                  profile address stays the same.
                </Label>
              </div>
            )}
          </div>
        </div>
        <div id="title" className={rowClass}>
          <Label htmlFor="account-title" className="self-start sm:pt-3">
            Custom title
          </Label>
          <div className="min-w-0 space-y-2">
            <Input
              id="account-title"
              name="title"
              value={titleValue}
              onChange={(event) => setTitleValue(event.target.value)}
              disabled={!canChangeTitle || pending}
              maxLength={TITLE_MAX_LENGTH}
              placeholder="Your default title"
              aria-describedby="title-rules"
              aria-invalid={state?.field === "title" || undefined}
            />
            <p id="title-rules" className="text-xs text-muted-foreground">
              Up to {TITLE_MAX_LENGTH} characters. Leave blank to use the title
              that comes with your level.
              {!canChangeTitle && (
                <>
                  {" "}
                  <Link
                    href="/credits?category=permission#permission-customTitle"
                    className={linkClass}
                  >
                    Unlock a custom title in the shop
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t p-4">
        <PendingButton
          disabled={!canChangeUsername && !canChangeTitle}
          className="min-h-10 px-4"
        >
          {pending ? "Saving…" : "Save changes"}
        </PendingButton>
        <output
          className={cn(
            "text-xs font-medium empty:hidden",
            error ? "text-destructive" : "text-success",
          )}
        >
          {state?.field === "title" && state.usernameSaved
            ? "Your username was saved. "
            : ""}
          {error ?? (!pending && saved ? "Saved" : "")}
        </output>
      </div>
    </form>
  );
}
