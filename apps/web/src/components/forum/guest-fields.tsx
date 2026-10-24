"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { FormError } from "@/components/forum/form-error";
import { TurnstileField } from "@/components/forum/turnstile-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// What a guest gives with a post besides the text: the name it is shown under, and the security
// check (`guestPost`) the site guards the form with. The name is the form's `name` field and the
// check's token its hidden field. `retry` changes whenever an attempt comes back, for a new token.
export function GuestFields({
  turnstileKey,
  nameError,
  retry,
}: {
  turnstileKey: string;
  // The backend's refusal of the name, said under it.
  nameError?: string;
  retry?: unknown;
}) {
  const t = useTranslations("forum.guestPosting");
  const id = useId();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={id}>{t("nameLabel")}</Label>
        <Input
          id={id}
          name="name"
          autoComplete="nickname"
          required
          minLength={2}
          maxLength={50}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={`${id}-help`}
        />
        {nameError ? (
          <FormError id={`${id}-help`}>{nameError}</FormError>
        ) : (
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            {t("nameHelp")}
          </p>
        )}
      </div>
      {turnstileKey && (
        <TurnstileField
          siteKey={turnstileKey}
          action="guestPost"
          retry={retry}
        />
      )}
    </div>
  );
}
