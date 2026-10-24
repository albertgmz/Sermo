"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";

// "Mark as unread": puts the conversation back among the unread ones and goes to the list. The
// action is asked for when the button is pressed, so it is no part of the page's first load. It
// can be refused; the backend's reason is shown under the header's row.
export function MarkUnreadForm({
  conversationId,
  label,
  children,
}: {
  conversationId: number;
  label: string;
  children: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        disabled={pending}
        className="h-10 px-2 text-xs text-muted-foreground"
        onClick={() =>
          start(async () => {
            const { markUnreadAction } = await import(
              "@/app/[locale]/(main)/conversations/actions"
            );
            setError((await markUnreadAction(conversationId, {})).error);
          })
        }
      >
        {children}
        <span>{label}</span>
      </Button>
      {error && (
        <FormError className="basis-full px-2 text-xs">{error}</FormError>
      )}
    </>
  );
}
