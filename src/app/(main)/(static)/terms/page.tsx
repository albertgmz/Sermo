import type { Metadata } from "next";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { StaticPage } from "@/app/(main)/(static)/static-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("static.terms");
  return {
    title: t("metaTitle"),
  };
}

export default function TermsPage() {
  const t = useTranslations("static.terms");
  const format = useFormatter();
  const CONTENT = `
${t("introduction")}

## ${t("accountHeading")}

- ${t("accountResponsibility")}
- ${t("accountLimit")}
- ${t("accountUsername")}

## ${t("postsHeading")}

${t("postsRights")}

${t("postsRestrictions")}

1. ${t("postsSpam")}
2. ${t("postsAbuse")}
3. ${t("postsPrivacy")}

## ${t("moderationHeading")}

${t("moderationDescription")}

## ${t("creditsHeading")}

${t("creditsDescription")}

## ${t("changesHeading")}

${t("changesDescription")}
`;

  return (
    <StaticPage
      href="/terms"
      title={t("title")}
      updated={format.dateTime(new Date("2026-09-01T00:00:00Z"), {
        dateStyle: "long",
      })}
      content={CONTENT}
    />
  );
}
