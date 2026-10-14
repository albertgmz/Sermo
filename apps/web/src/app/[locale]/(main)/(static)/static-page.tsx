import { pagesGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache } from "react";
import { HtmlContent } from "@/components/forum/html-content";
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

// The title and the text are asked once for the metadata and the page.
const getPage = cache((slug: string) => read(pagesGet, { slug }));

export async function staticPageMetadata(slug: string): Promise<Metadata> {
  return { title: (await getPage(slug)).title };
}

// The pages listed beside a page are the links under the legal heading of the footer.
async function siblingLinks(): Promise<LinkItem[]> {
  const { footer } = await getNavigation();
  const legal = toNavItems(footer).find(
    (entry) => entry.builtin === "footer.legal",
  );
  return legal ? legal.children.filter(hasHref) : [];
}

export async function StaticPage({
  slug,
  path,
}: {
  slug: string;
  path: string;
}) {
  const [page, links, t, format] = await Promise.all([
    getPage(slug),
    siblingLinks(),
    getTranslations("static.staticPage"),
    getFormatter(),
  ]);
  return (
    <PageLayout
      asideSide="start"
      asideOnMobile="hidden"
      className="md:pt-8"
      aside={
        links.length > 0 && (
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
        )
      }
    >
      <article className="max-w-prose">
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {page.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("updated", {
            date: format.dateTime(new Date(page.updatedAt), {
              dateStyle: "long",
            }),
          })}
        </p>
        <HtmlContent className="mt-6">{page.bodyHtml}</HtmlContent>
      </article>
    </PageLayout>
  );
}
