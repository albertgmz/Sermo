import { tagsGet } from "@sermo/core/contracts";
import { Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { moreTagThreads } from "@/app/[locale]/(main)/tags/[name]/more-threads";
import { tagThreadsPage } from "@/app/[locale]/(main)/tags/[name]/tag-page";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PagedList } from "@/components/forum/paged-list";
import { LoadingRegion, ThreadRowSkeleton } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { pagesParam } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { publicHead } from "@/lib/sermo/share";
import { tagHref } from "@/lib/sermo/tags";
import { cn } from "@/lib/utils";

// A tag is addressed by its name: letters, numbers and `_` never need percent-encoding to mean
// themselves, but the router may hand over the encoded form of an accented one.
function nameOf(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// The tag is asked once for the metadata and the page. One that does not exist, or has nothing the
// visitor may open, is the 404; an old name of a renamed or merged tag goes to the current one.
const getTag = cache(async (name: string) => {
  const found = await read(tagsGet, { name });
  if (found.redirect) permanentRedirect(tagHref(found.name));
  return found;
});

// The backend has one address for a tag; a list continued by cursor is a copy of it.
export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/tags/[name]">): Promise<Metadata> {
  const [{ name }, { cursor, pages }, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("forums.tagPage"),
  ]);
  const tag = await getTag(nameOf(name));
  const seo =
    cursor !== undefined || pages !== undefined ? copyOf(tag.seo) : tag.seo;
  const head = seoMetadata({
    ...seo,
    description: t("metaDescription", { name: tag.name }),
  });
  // Shared only when the backend indexes the tag: enough of its threads are open to guests.
  if (tag.seo.robots !== "index,follow") return head;
  return publicHead(head, { title: `#${tag.name}` });
}

export default async function TagPage({
  params,
  searchParams,
}: PageProps<"/[locale]/tags/[name]">) {
  const [{ name: raw }, { cursor, pages }] = await Promise.all([
    params,
    searchParams,
  ]);
  const [tag, t] = await Promise.all([
    getTag(nameOf(raw)),
    getTranslations("forums.tagPage"),
  ]);
  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[{ label: t("home"), href: "/" }, { label: `#${tag.name}` }]}
      />
      <div className="mt-1 min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          #{tag.name}
        </h1>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          {t("description", { name: tag.name })}
        </p>
      </div>
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loading")}>
            <div className="mt-4 divide-y overflow-hidden rounded-lg border bg-card">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
                <ThreadRowSkeleton key={row} />
              ))}
            </div>
          </LoadingRegion>
        }
      >
        <TagThreads
          name={tag.name}
          cursor={typeof cursor === "string" ? cursor : undefined}
          pages={pagesParam(pages)}
        />
      </Suspense>
    </PageLayout>
  );
}

async function TagThreads({
  name,
  cursor,
  pages,
}: {
  name: string;
  cursor: string | undefined;
  pages: number;
}) {
  const [first, t] = await Promise.all([
    tagThreadsPage(name, cursor),
    getTranslations("forums.tagPage"),
  ]);
  // Nothing here and nowhere to go on: a tag with no thread yet, or a link into the list that
  // lands past its end (with a way back to the start). An empty page that says where to go on
  // (the walk stopped at hidden rows) is still the list, with its button.
  if (first.rows.length === 0 && first.nextCursor === null) {
    return (
      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        <EmptyState
          icon={Tag}
          title={cursor ? t("noMoreTitle") : t("emptyTitle")}
          description={cursor ? t("noMoreDescription") : t("emptyDescription")}
        >
          {cursor && (
            <Link
              href={tagHref(name)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 px-4",
              )}
            >
              {t("backToStart")}
            </Link>
          )}
        </EmptyState>
      </div>
    );
  }
  return (
    <PagedList
      first={first}
      more={moreTagThreads.bind(null, name)}
      pages={pages}
      start={cursor}
      listKey={["tag", name]}
      hrefBase={tagHref(name)}
      moreLabel={t("loadMore")}
      estimateSize={72}
      as="ul"
      className="mt-4 overflow-hidden rounded-lg border bg-card"
      moreClassName="mt-3"
    />
  );
}
