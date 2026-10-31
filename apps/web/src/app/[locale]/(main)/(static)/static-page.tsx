import { pagesGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { SiblingNavSkeleton } from "@/app/[locale]/(main)/(static)/static-loading";
import { HtmlContent } from "@/components/forum/html-content";
import { RelativeTime } from "@/components/forum/relative-time";
import {
  hasHref,
  isCurrent,
  type LinkItem,
  linkProps,
  toNavItems,
} from "@/components/layout/nav";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { getNavigation } from "@/lib/sermo/navigation";
import { publicPage } from "@/lib/sermo/public-page";
import { publicHead } from "@/lib/sermo/share";

// The title and the text are asked once for the metadata and the page: the shared read first (the
// text is then in the first HTML), and as the visitor when a guest cannot have the page (an
// administrator opens one that is not published).
const getPage = cache(
  async (slug: string) => (await publicPage(slug)) ?? read(pagesGet, { slug }),
);

export async function staticPageMetadata(
  slug: string,
  path: string,
): Promise<Metadata> {
  return publicHead({ title: (await getPage(slug)).title }, { path });
}

// The pages listed beside a page are the links under the legal heading of the footer.
async function siblingLinks(): Promise<LinkItem[]> {
  const { footer } = await getNavigation();
  const legal = toNavItems(footer).find(
    (entry) => entry.builtin === "footer.legal",
  );
  return legal ? legal.children.filter(hasHref) : [];
}

// The links beside the text are the visitor's: the navigation is asked with their cookies. They
// come in their own boundary, so the text, the same for every visitor, does not wait for them.
async function SiblingNav({ path }: { path: string }) {
  const [links, t] = await Promise.all([
    siblingLinks(),
    getTranslations("static.staticPage"),
  ]);
  if (links.length === 0) return null;
  return (
    <nav aria-label={t("aria.navigation")}>
      <ul className="border-l">
        {links.map((link) => (
          <li key={link.id}>
            <Link
              {...linkProps(link)}
              aria-current={isCurrent(path, link) ? "page" : undefined}
              className="-ml-px flex h-9 items-center border-l border-transparent pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function StaticPage({
  slug,
  path,
  after,
}: {
  slug: string;
  path: string;
  // Shown under the page's own text (the privacy page adds what the server records).
  after?: React.ReactNode;
}) {
  const [page, t] = await Promise.all([
    getPage(slug),
    getTranslations("static.staticPage"),
  ]);
  return (
    <PageLayout
      asideSide="start"
      asideOnMobile="hidden"
      className="md:pt-8"
      aside={
        <Suspense fallback={<SiblingNavSkeleton />}>
          <SiblingNav path={path} />
        </Suspense>
      }
    >
      <article className="max-w-prose">
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {page.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.rich("updated", {
            time: (chunks) => (
              <RelativeTime date={page.updatedAt}>{chunks}</RelativeTime>
            ),
          })}
        </p>
        <HtmlContent className="mt-6">{page.bodyHtml}</HtmlContent>
        {after}
      </article>
    </PageLayout>
  );
}
