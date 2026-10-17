import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { publicHead } from "@/lib/sermo/share";
import { ApiReference } from "./api-reference";
import { DeveloperIntro } from "./intro";

// A public page, open to search engines: the interface text is the same for every visitor.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("developer.page");
  return publicHead(
    { title: t("metaTitle"), description: t("metaDescription") },
    { path: "/developer" },
  );
}

// The page fills the window in its own frame (../layout.tsx), to give the reference room.
export default async function DeveloperPage() {
  const [t, reference] = await Promise.all([
    getTranslations("developer.page"),
    getTranslations("developer.apiReference"),
  ]);
  return (
    <>
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
    </>
  );
}
