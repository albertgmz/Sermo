import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LogShell } from "../log-shell";
import { ModeratorLog } from "./moderator-log";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTools.moderatorLog");
  return { title: t("metaTitle") };
}

export default function ModeratorLogPage({
  searchParams,
}: PageProps<"/[locale]/admin/logs/moderator">) {
  const t = useTranslations("adminTools.moderatorLog");
  return (
    <LogShell
      heading={t("heading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <ModeratorLog searchParams={searchParams} />
    </LogShell>
  );
}
