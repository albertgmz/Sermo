import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { StaticPage } from "@/app/(main)/(static)/static-page";
import { getSite } from "@/lib/sermo/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("static.legal");
  return {
    title: t("metaTitle"),
  };
}

export default async function LegalPage() {
  const [t, format, site] = await Promise.all([
    getTranslations("static.legal"),
    getFormatter(),
    getSite(),
  ]);
  const CONTENT = `
${t("introduction")}

## ${t("publisherHeading")}

${t.rich("publisherAddress", {
  site: site.name,
  strong: (chunks) => `**${chunks}**`,
})}

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
