import type { Metadata } from "next";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { StaticPage } from "@/app/(main)/(static)/static-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("static.privacy");
  return {
    title: t("metaTitle"),
  };
}

export default function PrivacyPage() {
  const t = useTranslations("static.privacy");
  const format = useFormatter();
  const CONTENT = `
${t("introduction")}

## ${t("collectionHeading")}

- ${t.rich("collectionAccount", { strong: (chunks) => `**${chunks}**` })}
- ${t.rich("collectionContent", { strong: (chunks) => `**${chunks}**` })}
- ${t.rich("collectionTechnical", { strong: (chunks) => `**${chunks}**` })}

## ${t("usageHeading")}

${t("usageDescription")}

## ${t("cookiesHeading")}

${t("cookiesDescription")}

## ${t("choicesHeading")}

${t.rich("choicesDescription", {
  account: (chunks) => `[${chunks}](/account)`,
  contact: (chunks) => `[${chunks}](/contact)`,
})}

## ${t("retentionHeading")}

${t("retentionDescription")}
`;

  return (
    <StaticPage
      href="/privacy"
      title={t("title")}
      updated={format.dateTime(new Date("2026-09-01T00:00:00Z"), {
        dateStyle: "long",
      })}
      content={CONTENT}
    />
  );
}
