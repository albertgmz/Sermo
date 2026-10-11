import Link from "next/link";
import { Markdown } from "@/components/forum/markdown";
import { PageLayout } from "@/components/layout/page-layout";

const PAGES = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Legal notice", href: "/legal" },
  { label: "Contact", href: "/contact" },
];

export function StaticPage({
  href,
  title,
  updated,
  content,
  children,
}: {
  href: string;
  title: string;
  updated: string;
  content: string;
  children?: React.ReactNode;
}) {
  return (
    <PageLayout
      asideSide="start"
      asideOnMobile="hidden"
      className="md:pt-8"
      aside={
        <nav aria-label="Information pages">
          <ul className="border-l">
            {PAGES.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  aria-current={page.href === href ? "page" : undefined}
                  className="-ml-px flex h-9 items-center border-l border-transparent pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
                >
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      }
    >
      <article className="max-w-prose">
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Last updated {updated}
        </p>
        <Markdown className="mt-6">{content}</Markdown>
        {children}
      </article>
    </PageLayout>
  );
}
