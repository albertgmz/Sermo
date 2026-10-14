"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { dismissNotice } from "@/app/[locale]/(main)/actions";
import { Button } from "@/components/ui/button";

// The button that hides a dismissible site notice; the page is drawn again without it.
export function NoticeDismissButton({ id }: { id: number }) {
  const t = useTranslations("layout.noticeBanner");
  return (
    <form action={dismissNotice.bind(null, id)}>
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="size-10 shrink-0"
        aria-label={t("dismiss")}
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </form>
  );
}
