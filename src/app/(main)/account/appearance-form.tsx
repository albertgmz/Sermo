"use client";

import { useActionState } from "react";
import {
  type AppearanceField,
  type AppearanceState,
  saveAppearance,
} from "@/app/(main)/account/actions";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_found: "Your account was not found.",
  invalid: "That choice is not valid.",
  not_owned: "You do not own that yet.",
  not_allowed: "You need the profile cover permission for that.",
};

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
  const [state, action, pending] = useActionState<AppearanceState, FormData>(
    saveAppearance.bind(null, field),
    null,
  );

  let status = "";
  if (pending) status = "Saving…";
  else if (state) status = ERRORS[state.error];
  else if (saved) status = "Saved";

  return (
    <form action={action} className="space-y-3">
      <div className="flex min-h-10 items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        <output
          className={cn(
            "h-4 shrink-0 text-xs font-medium",
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
