"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  type AppearanceField,
  type AppearanceState,
  saveAppearance,
} from "@/app/(main)/account/actions";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_found: "errors.notFound",
  invalid: "errors.invalid",
  not_owned: "errors.notOwned",
  not_allowed: "errors.notAllowed",
} as const;

// One appearance setting: every choice inside is a submit button named
// "value", so picking one saves it.
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
  const [state, action, pending] = useActionState<AppearanceState, FormData>(
    saveAppearance.bind(null, field),
    null,
  );

  let status = "";
  if (pending) status = t("pending");
  else if (state) status = t(ERRORS[state.error]);
  else if (saved) status = t("saved");

  return (
    <form action={action} className="space-y-3">
      <div className="flex min-h-10 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        <output
          className={cn(
            "min-h-4 max-w-full text-xs font-medium",
            state && !pending ? "text-destructive" : "text-success",
            pending && "text-muted-foreground",
          )}
        >
          {status}
        </output>
      </div>
      {children}
    </form>
  );
}
