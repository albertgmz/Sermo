"use client";

// RunNow: queues the sweep of every member against every active automatic award, and shows the
// backend's answer under the button.

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Button } from "@/components/ui/button";

function Submit() {
  const t = useTranslations("adminEconomy.awards");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-h-10 px-4">
      {pending ? t("running") : t("run")}
    </Button>
  );
}

export function RunNow({
  action,
}: {
  action: (previous: StaffFormState) => Promise<StaffFormState>;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Submit />
      <output
        className={
          state?.error
            ? "text-xs font-medium text-destructive empty:hidden"
            : "text-xs font-medium text-success empty:hidden"
        }
      >
        {state?.error ?? state?.notice}
      </output>
    </form>
  );
}
