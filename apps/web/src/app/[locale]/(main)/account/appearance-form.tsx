"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { FormState } from "@/app/[locale]/(main)/account/action-form";
import {
  type AppearanceField,
  saveAppearance,
} from "@/app/[locale]/(main)/account/actions";
import { cn } from "@/lib/utils";

// One appearance setting: every choice inside is a submit button named "value", so picking one
// saves it.
export function AppearanceForm({
  field,
  title,
  description,
  saved,
  children,
}: {
  field: AppearanceField;
  title: string;
  description: React.ReactNode;
  saved: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("account.appearanceForm");
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveAppearance.bind(null, field),
    null,
  );
  return (
    <form id={field} action={action} className="scroll-mt-4 space-y-3">
      <div className="flex min-h-10 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        <output
          className={cn(
            "min-h-4 max-w-full text-xs font-medium [overflow-wrap:anywhere]",
            state && !pending ? "text-destructive" : "text-success",
            pending && "text-muted-foreground",
          )}
        >
          {pending ? t("pending") : (state?.error ?? (saved ? t("saved") : ""))}
        </output>
      </div>
      {children}
    </form>
  );
}
