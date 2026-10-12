"use client";

import type { DemoState } from "@/app/(main)/admin/actions";
import { Button } from "@/components/ui/button";

export function FormFooter({
  state,
  pending,
}: {
  state: DemoState;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <p
        id="form-error"
        role="alert"
        className="text-sm text-destructive empty:hidden"
      >
        {state?.error}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="min-h-10">
          {pending ? "Checking changes…" : "Save changes"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Demo only · Changes are not stored
        </p>
      </div>
    </div>
  );
}
