"use client";

import { useActionState } from "react";
import {
  type MarkAllState,
  markAllRead,
} from "@/app/(main)/notifications/actions";
import { PendingButton } from "@/components/forum/pending-button";

// Marks every notification read. The backend's reason is shown if it refuses.
export function MarkAllReadForm({
  disabled,
  variant,
  size,
  className,
  children,
}: {
  disabled: boolean;
  variant: "outline" | "ghost";
  size?: "sm";
  className?: string;
  children: React.ReactNode;
}) {
  const [state, action] = useActionState<MarkAllState>(markAllRead, {});
  return (
    <form action={action} className="flex flex-col items-end">
      <PendingButton
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
      >
        {children}
      </PendingButton>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
