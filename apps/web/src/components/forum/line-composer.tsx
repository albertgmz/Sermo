"use client";

import { SendHorizontal } from "lucide-react";
import { useActionState } from "react";
import type { WallState } from "@/app/(main)/members/actions";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

// The one-line composer for the comments of a wall post. The backend's refusal is shown as it
// comes.
export function WallComposer({
  action,
  placeholder,
  submitLabel,
  className,
}: {
  action: (previous: WallState, formData: FormData) => Promise<WallState>;
  placeholder: string;
  submitLabel: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={cn("space-y-2", className)}>
      <div className="flex items-end gap-2">
        <LazyEditor
          name="body"
          placeholder={placeholder}
          className="flex-1 rounded-4xl"
        />
        <PendingButton size="icon" aria-label={submitLabel} className="size-10">
          <SendHorizontal />
        </PendingButton>
      </div>
      {state.error && <FormError>{state.error}</FormError>}
    </form>
  );
}
