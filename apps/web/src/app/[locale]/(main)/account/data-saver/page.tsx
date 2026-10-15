import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LiteSettingsForm } from "@/app/[locale]/(main)/data-saver/settings-form";
import { getLiteState } from "@/lib/lite-mode";
import { serializeLiteCookie } from "@/lib/lite-preferences";
import { getMember } from "@/lib/sermo/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("lite.page");
  return { title: t("metaTitle") };
}

export default async function LitePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const [{ user }, state, { saved }] = await Promise.all([
    getMember(),
    getLiteState(),
    searchParams,
  ]);
  if (!user) redirect("/login");

  return (
    <LiteSettingsForm
      key={serializeLiteCookie(state)}
      state={state}
      returnTo="/account/data-saver?saved=1"
      saved={saved === "1"}
    />
  );
}
