"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import {
  type MarkAllState,
  markAllRead,
} from "@/app/(main)/notifications/actions";
import { markAllThenRefresh } from "@/app/(main)/notifications/mark-all";
import { FormError } from "@/components/forum/form-error";
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
  const router = useRouter();
  const [state, action] = useActionState<MarkAllState>(
    (previous) =>
      markAllThenRefresh(markAllRead, () => router.refresh(), previous),
    {},
  );
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
        <FormError className="mt-1 text-xs">{state.error}</FormError>
      )}
    </form>
  );
}
