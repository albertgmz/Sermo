"use client";

import { useActionState, useState } from "react";
import {
  type SignatureState,
  saveSignature,
} from "@/app/(main)/account/actions";
import { Editor } from "@/components/forum/editor";
import { PendingButton } from "@/components/forum/pending-button";
import { Signature } from "@/components/forum/signature";
import { SIGNATURE_MAX_LENGTH, SIGNATURE_MAX_LINES } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const fieldsetClass = "min-w-0 space-y-2 disabled:opacity-60";
const actionClass = "min-h-10 px-4";

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
  const [state, action, pending] = useActionState<SignatureState, FormData>(
    saveSignature,
    null,
  );
  const [value, setValue] = useState(signature);
  const text = value.replace(/\r\n?/g, "\n").trim();
  const lines = text ? text.split("\n").length : 0;
  const over =
    text.length > SIGNATURE_MAX_LENGTH || lines > SIGNATURE_MAX_LINES;

  return (
    <form
      action={action}
      onResetCapture={(event) => {
        // Keep the editor draft when the server returns a validation error.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <fieldset
        disabled={locked}
        aria-describedby="signature-count"
        className={fieldsetClass}
      >
        <legend className="sr-only">Signature</legend>
        {signature && locked && (
          <div className="rounded-md border bg-background/60 p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Current signature
            </p>
            <Signature>{signature}</Signature>
          </div>
        )}
        {!locked && (
          <div inert={pending}>
            <Editor
              name="signature"
              defaultValue={signature}
              aria-invalid={over || undefined}
              aria-describedby={over ? "signature-count" : undefined}
              placeholder={
                signature
                  ? "Write a replacement signature."
                  : "Write your signature."
              }
              onChange={setValue}
            />
          </div>
        )}
        {signature && !locked && (
          <p className="text-xs text-muted-foreground">
            Your current signature stays until you save a replacement or clear
            it.
          </p>
        )}
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
          <PendingButton disabled={over || !text} className={actionClass}>
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
            saved={saved && !pending}
          />
        </div>
      </fieldset>
    </form>
  );
}
