import type { Metadata } from "next";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ContactForm } from "@/app/(main)/(static)/contact/contact-form";
import { StaticPage } from "@/app/(main)/(static)/static-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("static.contact");
  return {
    title: t("metaTitle"),
  };
}

export default function ContactPage() {
  const t = useTranslations("static.contact");
  const format = useFormatter();
  const CONTENT = `
${t("introduction")}

## ${t("detailsHeading")}

- ${t.rich("detailsGeneral", { strong: (chunks) => `**${chunks}**` })}
- ${t.rich("detailsSupport", { strong: (chunks) => `**${chunks}**` })}
- ${t.rich("detailsAddress", { strong: (chunks) => `**${chunks}**` })}

${t("responseDescription")}
`;

  return (
    <StaticPage
      href="/contact"
      title={t("title")}
      updated={format.dateTime(new Date("2026-09-01T00:00:00Z"), {
        dateStyle: "long",
      })}
      content={CONTENT}
    >
      <ContactForm />
    </StaticPage>
  );
}
