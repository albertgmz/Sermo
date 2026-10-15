import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageLayout } from "@/components/layout/page-layout";
import { ApiReference } from "./api-reference";
import { DeveloperIntro } from "./intro";

// A public page, open to search engines: the interface text is the same for every visitor.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("developer.page");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function DeveloperPage() {
  const [t, reference] = await Promise.all([
    getTranslations("developer.page"),
    getTranslations("developer.apiReference"),
  ]);
  return (
    <PageLayout className="md:pt-8">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-balance">
        {t("title")}
      </h1>
      <DeveloperIntro />
      <ApiReference
        labels={{
          region: reference("region"),
          loading: reference("loading"),
          failed: reference("failed"),
          retry: reference("retry"),
        }}
      />
    </PageLayout>
  );
}
