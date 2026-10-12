"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("account.permissionForms");
  return (
    <output
      className={cn(
        "block text-xs font-medium empty:hidden",
        error ? "text-destructive" : "text-success",
      )}
    >
      {error ?? (saved ? t("saved") : "")}
    </output>
  );
}

const SIGNATURE_ERRORS = {
  not_found: "errors.notFound",
  not_allowed: "errors.notAllowed",
  too_long: "errors.tooLong",
  too_many_lines: "errors.tooManyLines",
} as const;

export function SignatureForm({
  signature,
  locked,
  saved,
}: {
  signature: string;
  locked: boolean;
  saved: boolean;
}) {
  const t = useTranslations("account.permissionForms");
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
        <legend className="sr-only">{t("legend")}</legend>
        {signature && locked && (
          <div className="rounded-md border bg-background/60 p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("currentHeading")}
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
                signature ? t("replacementPlaceholder") : t("placeholder")
              }
              onChange={setValue}
            />
          </div>
        )}
        {signature && !locked && (
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        )}
        <p
          id="signature-count"
          className={cn(
            "text-xs tabular-nums",
            over ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {t("characters", { used: text.length, count: SIGNATURE_MAX_LENGTH })}
          <span aria-hidden="true"> · </span>
          {t("lines", { used: lines, count: SIGNATURE_MAX_LINES })}
        </p>
        {text && (
          <div className="rounded-md border bg-background/60 p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("previewHeading")}
            </p>
            <Signature>{text}</Signature>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PendingButton disabled={over || !text} className={actionClass}>
            {t("submit")}
          </PendingButton>
          <PendingButton
            variant="outline"
            name="clear"
            value="1"
            disabled={!signature}
            className={actionClass}
          >
            {t("clear")}
          </PendingButton>
          <Status
            error={
              state
                ? t(SIGNATURE_ERRORS[state.error], {
                    count:
                      state.error === "too_many_lines"
                        ? SIGNATURE_MAX_LINES
                        : SIGNATURE_MAX_LENGTH,
                  })
                : undefined
            }
            saved={saved && !pending}
          />
        </div>
      </fieldset>
    </form>
  );
}
