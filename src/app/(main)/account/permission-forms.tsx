"use client";

import { useActionState, useState } from "react";
import {
  type SignatureState,
  saveSignature,
  saveTitle,
  saveUsername,
  type TitleState,
  type UsernameState,
} from "@/app/(main)/account/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { Signature } from "@/components/forum/signature";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SIGNATURE_MAX_LENGTH,
  SIGNATURE_MAX_LINES,
  TITLE_MAX_LENGTH,
  USERNAME_PATTERN,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

const fieldsetClass = "min-w-0 space-y-2 disabled:opacity-60";
const actionClass = "h-10 px-4 md:h-8 md:px-3";

function Status({
  error,
  saved,
}: {
  error: string | undefined;
  saved: boolean;
}) {
  return (
    <output
      className={cn(
        "block text-xs font-medium empty:hidden",
        error ? "text-destructive" : "text-success",
      )}
    >
      {error ?? (saved ? "Saved" : "")}
    </output>
  );
}

const SIGNATURE_ERRORS = {
  not_found: "Your account was not found.",
  not_allowed: "You need the signature permission for that.",
  too_long: `A signature holds at most ${SIGNATURE_MAX_LENGTH} characters.`,
  too_many_lines: `A signature holds at most ${SIGNATURE_MAX_LINES} lines.`,
};

export function SignatureForm({
  signature,
  locked,
  saved,
}: {
  signature: string;
  locked: boolean;
  saved: boolean;
}) {
  const [state, action] = useActionState<SignatureState, FormData>(
    saveSignature,
    null,
  );
  const [value, setValue] = useState(signature);
  const text = value.trim();
  const lines = text ? text.split("\n").length : 0;
  const over =
    text.length > SIGNATURE_MAX_LENGTH || lines > SIGNATURE_MAX_LINES;

  return (
    <form action={action}>
      <fieldset disabled={locked} className={fieldsetClass}>
        <Textarea
          name="signature"
          aria-label="Signature"
          aria-invalid={over || undefined}
          aria-describedby="signature-count"
          placeholder="A line or two shown under your posts. Markdown works."
          rows={3}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p
          id="signature-count"
          className={cn(
            "text-xs tabular-nums",
            over ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {text.length}/{SIGNATURE_MAX_LENGTH} characters
          <span aria-hidden="true"> · </span>
          {lines}/{SIGNATURE_MAX_LINES} lines
        </p>
        {text && (
          <div className="rounded-md border bg-background/60 p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Preview
            </p>
            <Signature>{text}</Signature>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PendingButton disabled={over} className={actionClass}>
            Save signature
          </PendingButton>
          <PendingButton
            variant="outline"
            name="clear"
            value="1"
            disabled={!signature}
            className={actionClass}
          >
            Clear
          </PendingButton>
          <Status
            error={state ? SIGNATURE_ERRORS[state.error] : undefined}
            saved={saved}
          />
        </div>
      </fieldset>
    </form>
  );
}

const TITLE_ERRORS = {
  not_found: "Your account was not found.",
  not_allowed: "You need the custom title permission for that.",
  too_long: `A title holds at most ${TITLE_MAX_LENGTH} characters.`,
};

export function TitleForm({
  title,
  locked,
  saved,
}: {
  title: string;
  locked: boolean;
  saved: boolean;
}) {
  const [state, action] = useActionState<TitleState, FormData>(saveTitle, null);
  return (
    <form action={action}>
      <fieldset disabled={locked} className={fieldsetClass}>
        <Input
          name="title"
          aria-label="Custom title"
          aria-describedby="title-rules"
          defaultValue={title}
          maxLength={TITLE_MAX_LENGTH}
          placeholder="Your own title"
          className="max-w-sm"
        />
        <p id="title-rules" className="text-xs text-muted-foreground">
          Up to {TITLE_MAX_LENGTH} characters. Resetting brings back the title
          that comes with your level.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <PendingButton className={actionClass}>Save title</PendingButton>
          <PendingButton
            variant="outline"
            name="reset"
            value="1"
            disabled={!title}
            className={actionClass}
          >
            Reset to default
          </PendingButton>
          <Status
            error={state ? TITLE_ERRORS[state.error] : undefined}
            saved={saved}
          />
        </div>
      </fieldset>
    </form>
  );
}

const USERNAME_ERRORS = {
  not_found: "Your account was not found.",
  not_allowed: "You have no username change left.",
  invalid:
    "Use 3 to 20 letters, numbers, underscores or hyphens, and a name different from your current one.",
  taken: "That username is already taken.",
  unconfirmed: "Confirm your username change.",
};

export function UsernameForm({
  username,
  locked,
  saved,
}: {
  username: string;
  locked: boolean;
  saved: boolean;
}) {
  const [state, action] = useActionState<UsernameState, FormData>(
    saveUsername,
    null,
  );
  const [value, setValue] = useState("");
  const next = value.trim();
  return (
    <form action={action}>
      <fieldset disabled={locked} className={fieldsetClass}>
        <Input
          name="username"
          aria-label="New username"
          aria-describedby="username-rules"
          autoComplete="off"
          placeholder={username}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="max-w-sm"
        />
        <p id="username-rules" className="text-xs text-muted-foreground">
          3 to 20 characters: letters, numbers, underscores and hyphens.
        </p>
        <div className="flex min-h-10 items-center gap-2 md:min-h-0">
          <Checkbox
            id="username-confirm"
            name="confirm"
            value="on"
            disabled={locked}
          />
          <Label
            htmlFor="username-confirm"
            className="block leading-normal font-normal text-muted-foreground [overflow-wrap:anywhere]"
          >
            I want to change my username to{" "}
            {USERNAME_PATTERN.test(next) ? next : "my new username"}. My profile
            address stays the same.
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PendingButton className={actionClass}>Change username</PendingButton>
          <Status
            error={state ? USERNAME_ERRORS[state.error] : undefined}
            saved={saved}
          />
        </div>
      </fieldset>
    </form>
  );
}
