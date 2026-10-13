"use client";

// RunNow: queues a sweep of every member against the rules of a screen (awards, promotions), and
// shows the backend's answer under the button.
//
// Props
//   action     The server action that queues the sweep.
//   namespace  The screen's message namespace; its `run` and `running` are the button's text.

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Button } from "@/components/ui/button";

type Namespace = "adminEconomy.awards" | "adminGroups.promotions";

function Submit({ namespace }: { namespace: Namespace }) {
  const t = useTranslations(namespace);
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-h-10 px-4">
      {pending ? t("running") : t("run")}
    </Button>
  );
}

export function RunNow({
  action,
  namespace,
}: {
  action: (previous: StaffFormState) => Promise<StaffFormState>;
  namespace: Namespace;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Submit namespace={namespace} />
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
