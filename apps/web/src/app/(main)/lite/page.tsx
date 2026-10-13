import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LiteSettingsForm } from "@/app/(main)/lite/settings-form";
import { PageLayout } from "@/components/layout/page-layout";
import { getLiteState } from "@/lib/lite-mode";
import { serializeLiteCookie } from "@/lib/lite-preferences";
import { getViewer } from "@/lib/sermo/session";

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
    getViewer(),
    getLiteState(),
    searchParams,
  ]);
  if (user) redirect("/account/lite");

  return (
    <PageLayout>
      <LiteSettingsForm
        key={serializeLiteCookie(state)}
        state={state}
        returnTo="/lite?saved=1"
        saved={saved === "1"}
      />
    </PageLayout>
  );
}
