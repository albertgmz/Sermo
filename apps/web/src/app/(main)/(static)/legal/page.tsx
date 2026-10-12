import type { Metadata } from "next";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { StaticPage } from "@/app/(main)/(static)/static-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("static.legal");
  return {
    title: t("metaTitle"),
  };
}

export default function LegalPage() {
  const t = useTranslations("static.legal");
  const format = useFormatter();
  const CONTENT = `
${t("introduction")}

## ${t("publisherHeading")}

${t.rich("publisherAddress", { strong: (chunks) => `**${chunks}**` })}

${t("publisherEmail")}

## ${t("hostingHeading")}

${t("hostingDescription")}

## ${t("contentHeading")}

${t("contentDescription")}

## ${t("reportingHeading")}

${t.rich("reportingDescription", {
  contact: (chunks) => `[${chunks}](/contact)`,
})}

## ${t("propertyHeading")}

${t.rich("propertyDescription", {
  terms: (chunks) => `[${chunks}](/terms)`,
})}
`;

  return (
    <StaticPage
      href="/legal"
      title={t("title")}
      updated={format.dateTime(new Date("2026-09-01T00:00:00Z"), {
        dateStyle: "long",
      })}
      content={CONTENT}
    />
  );
}
