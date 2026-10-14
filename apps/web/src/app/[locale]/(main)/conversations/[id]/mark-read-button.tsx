"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useContext, useState, useTransition } from "react";
import { MarkReadContext } from "@/app/[locale]/(main)/conversations/[id]/mark-read-state";
import { markReadAction } from "@/app/[locale]/(main)/conversations/actions";
import { FormError } from "@/components/forum/form-error";
import { SectionCard } from "@/components/forum/section-card";
import { Button } from "@/components/ui/button";

// The card for an unread conversation. Opening the page marks it read by itself, so the card is
// drawn only when that failed: it never flashes up for a mark that is about to succeed. Pressing it
// asks again, shows the backend's reason if refused, and redraws the page (and with it the unread
// counts in the site's frame) when it worked.
export function MarkReadCard({ conversationId }: { conversationId: number }) {
  const t = useTranslations("conversations.conversation");
  const { failed } = useContext(MarkReadContext);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!failed) return null;
  return (
    <SectionCard title={t("unread.title")}>
      <div className="space-y-2 p-4">
        {error && <FormError>{error}</FormError>}
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full px-3"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await markReadAction(conversationId);
              setError(result.error);
              if (!result.error) router.refresh();
            })
          }
        >
          <Check />
          {t("markRead")}
        </Button>
      </div>
    </SectionCard>
  );
}
