"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { EditThreadPopupProps } from "@/app/[locale]/(main)/threads/[id]/edit-thread-popup";
import { buttonVariants } from "@/components/ui/button";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

const loadPopup = () =>
  import("@/app/[locale]/(main)/threads/[id]/edit-thread-popup");

export const editThreadClass = cn(
  buttonVariants({ variant: "outline" }),
  "h-10 px-3",
);

// "Edit thread" among the thread's tools, as XenForo's: its title and prefix in a dialog over the
// page, saved in place. It is a link to the opening post's edit page, which has them too, for a
// browser without JavaScript and for a new tab; the dialog's code comes with the first reach for it.
export function EditThreadButton({
  threadId,
  href,
}: {
  threadId: number;
  href: string;
}) {
  const t = useTranslations("forum.inPlaceEdit");
  const popup: EditThreadPopupProps = { threadId, label: t("editThread") };
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      opening="link"
      onLoadError={() => window.location.assign(href)}
      trigger={(lazy) => (
        <Link
          href={href}
          aria-haspopup="dialog"
          className={editThreadClass}
          {...lazy}
        >
          <Pencil aria-hidden="true" />
          {t("editThread")}
        </Link>
      )}
    />
  );
}
