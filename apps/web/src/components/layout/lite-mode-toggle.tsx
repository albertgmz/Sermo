"use client";

import { Leaf, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useFormStatus } from "react-dom";
import { setLiteMode } from "@/app/[locale]/(main)/actions";
import { LiteStatus } from "@/app/[locale]/(main)/lite/status";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { LiteState } from "@/lib/lite-preferences";

function ToggleItem({ state }: { state: LiteState }) {
  const t = useTranslations("lite.liteModeToggle");
  const { pending } = useFormStatus();
  const statusId = useId();
  return (
    <DropdownMenuItem
      nativeButton
      render={<button type="submit" />}
      closeOnClick={false}
      disabled={pending}
      aria-label={t(state.master ? "aria.disable" : "aria.enable")}
      aria-describedby={statusId}
      className="min-h-10 w-full"
    >
      <Leaf />
      <span>{t("label")}</span>
      <span id={statusId} className="ml-auto text-xs text-muted-foreground">
        <LiteStatus state={state} />
      </span>
    </DropdownMenuItem>
  );
}

export function LiteModeToggle({ state }: { state: LiteState }) {
  const t = useTranslations("lite.liteModeToggle");
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <>
      <form action={setLiteMode}>
        <input type="hidden" name="mode" value={state.master ? "off" : "all"} />
        <input
          type="hidden"
          name="returnTo"
          value={pathname + (search ? `?${search}` : "")}
        />
        <ToggleItem state={state} />
      </form>
      <DropdownMenuItem
        className="min-h-10"
        render={<Link href="/account/lite" />}
      >
        <SlidersHorizontal />
        {t("settingsLink")}
      </DropdownMenuItem>
    </>
  );
}
