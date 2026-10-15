"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import {
  type MarkAllState,
  markAllRead,
} from "@/app/[locale]/(main)/notifications/actions";
import { markAllThenRefresh } from "@/app/[locale]/(main)/notifications/mark-all";
import { FormError } from "@/components/forum/form-error";
import { PendingButton } from "@/components/forum/pending-button";
import { useCounter } from "@/lib/counters";

// Marks every notification read. The backend's reason is shown if it refuses.
export function MarkAllReadForm(props: {
  disabled?: boolean;
  // Instead of `disabled`: the unread count the page drew; the button is off while the count as
  // the polls find it is none.
  unread?: number;
  variant: "outline" | "ghost";
  size?: "sm";
  className?: string;
  children: React.ReactNode;
}) {
  const { disabled, unread, variant, size, className, children } = props;
  const router = useRouter();
  const liveUnread = useCounter("notifications", unread ?? 0, props);
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
        disabled={disabled ?? (unread !== undefined && liveUnread === 0)}
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
