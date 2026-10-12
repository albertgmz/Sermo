"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { previewSettings } from "@/app/(main)/admin/actions";
import { FormFooter } from "@/app/(main)/admin/form-footer";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function SettingsForm() {
  const t = useTranslations("admin.settingsForm");
  const [state, action, pending] = useActionState(previewSettings, null);
  const [name, setName] = useState(t("defaultName"));
  const [description, setDescription] = useState(t("defaultDescription"));
  const [registration, setRegistration] = useState(true);

  return (
    <form action={action} aria-busy={pending} className="space-y-5 p-4">
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-5 disabled:opacity-60"
      >
        <div className="space-y-2">
          <Label htmlFor="site-name">{t("nameLabel")}</Label>
          <Input
            id="site-name"
            name="siteName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={60}
            aria-invalid={state?.field === "siteName"}
            aria-describedby={
              state?.field === "siteName" ? "form-error" : undefined
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-description">{t("descriptionLabel")}</Label>
          <Textarea
            id="site-description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            maxLength={300}
            rows={3}
            aria-invalid={state?.field === "description"}
            aria-describedby={
              state?.field === "description" ? "form-error" : undefined
            }
          />
        </div>
        <div>
          <Label htmlFor="registration" className="min-h-10 leading-normal">
            <Checkbox
              id="registration"
              name="registration"
              checked={registration}
              onCheckedChange={setRegistration}
              aria-invalid={state?.field === "registration"}
              aria-describedby={`registration-help${state?.field === "registration" ? " form-error" : ""}`}
            />
            {t("registrationLabel")}
          </Label>
          <p id="registration-help" className="text-xs text-muted-foreground">
            {t("registrationHelp")}
          </p>
        </div>
      </fieldset>
      <FormFooter state={state} pending={pending} />
    </form>
  );
}
