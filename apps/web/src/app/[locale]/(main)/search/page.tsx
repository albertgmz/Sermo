import { tagsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { pagesParam } from "@/lib/list-pages";
import { call } from "@/lib/sermo/client";
import { searchedTag, tagHref } from "@/lib/sermo/tags";
import { SearchBody } from "./search-body";
import { refusal } from "./search-page";
import { FormSkeleton, ResultsSkeleton } from "./skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("search.search");
  // The backend asks for the same on its own endpoint: result pages are never indexed.
  return { title: t("metaTitle"), robots: { index: false, follow: true } };
}

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

function idOf(value: string) {
  return /^[1-9]\d{0,15}$/.test(value) ? Number(value) : undefined;
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/[locale]/search">) {
  const [params, t] = await Promise.all([
    searchParams,
    getTranslations("search.search"),
  ]);
  // A search for a hashtag alone (`#rust`) that names a tag goes to the tag's page, which lists
  // its threads; any other text, or a hashtag that is no tag, is searched for as written.
  const tag = searchedTag(first(params.q));
  if (tag !== null) {
    const found = await refusal(call(tagsGet, { name: tag }));
    if ("value" in found) redirect(tagHref(found.value.name));
  }

  return (
    <PageLayout mainClassName="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingResults")}>
            <FormSkeleton />
            <ResultsSkeleton />
          </LoadingRegion>
        }
      >
        <SearchBody
          query={first(params.q)}
          titlesOnly={first(params.titles) === "1"}
          forum={idOf(first(params.forum))}
          prefix={idOf(first(params.prefix))}
          author={first(params.author)}
          cursor={first(params.cursor) || undefined}
          pages={pagesParam(params.pages)}
        />
      </Suspense>
    </PageLayout>
  );
}
