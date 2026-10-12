"use client";

import { SendHorizontal } from "lucide-react";
import { useActionState } from "react";
import type { WallState } from "@/app/(main)/members/actions";
import { Editor } from "@/components/forum/editor";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

// The one-line composer for walls and their comments. The backend's refusal is shown as it comes.
export function WallComposer({
  action,
  placeholder,
  submitLabel,
  avatar,
  className,
}: {
  action: (previous: WallState, formData: FormData) => Promise<WallState>;
  placeholder: string;
  submitLabel: string;
  // Drawn by the page: the avatar is a Server Component.
  avatar?: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={cn("space-y-2", className)}>
      <div className="flex items-end gap-2">
        {avatar && <div className="mr-1 self-start">{avatar}</div>}
        <Editor
          compact
          name="body"
          placeholder={placeholder}
          className="flex-1"
        />
        <PendingButton size="icon" aria-label={submitLabel} className="size-10">
          <SendHorizontal />
        </PendingButton>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
