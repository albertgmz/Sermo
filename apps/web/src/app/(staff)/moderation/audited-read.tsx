"use client";

// AuditedRead: the confirm step in front of a read that is itself written to the moderator log (a
// private message). Nothing is read until the button is pressed; the button posts the action, which
// makes the one read and returns what to show. `view` is a server-rendered element.
//
// Props
//   action  (previous, formData) => Promise<AuditedState>.
//   fields  Hidden fields the action reads (the id of the report or of the message).

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Section } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import type { AuditedState } from "./audited-state";

function Submit() {
  const t = useTranslations("moderation.auditedRead");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-h-10 px-4">
      {pending ? t("opening") : t("confirm")}
    </Button>
  );
}

export function AuditedRead({
  action,
  fields,
}: {
  action: (previous: AuditedState, formData: FormData) => Promise<AuditedState>;
  fields: Record<string, string>;
}) {
  const t = useTranslations("moderation.auditedRead");
  const [state, formAction] = useActionState(action, null);
  if (state?.view) return state.view;
  return (
    <Section heading={t("heading")} className="border-primary/40">
      <form action={formAction} className="space-y-3 p-4">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <p className="text-sm text-pretty">{t("warning")}</p>
        <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
          {state?.error}
        </output>
        <Submit />
      </form>
    </Section>
  );
}
