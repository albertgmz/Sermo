import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";

// PageHeader: the top of every page of the panel. Server-safe.
//
// Props
//   trail        The way up, from the panel's home to the page's parent (`staffTrail(path)` in
//                `(staff)/trail.ts` builds it from the registry). From 768 px it is a breadcrumb;
//                on a phone only its last step shows, as a "< parent" link. A promise is drawn
//                as soon as it settles, so the title never waits for it.
//   title        The page's heading.
//   description  Optional line under the title.
//   actions      Optional primary actions (buttons, links): at the top right from 640 px, below
//                the title on a phone.

export type Crumb = { href: string; label: string };

export function PageHeader({
  trail,
  title,
  description,
  actions,
}: {
  trail?: Crumb[] | Promise<Crumb[]>;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="space-y-2">
      {Array.isArray(trail) ? (
        <Trail crumbs={trail} />
      ) : (
        trail && (
          <Suspense fallback={<Skeleton className="h-10 w-40 md:h-8" />}>
            <AwaitedTrail crumbs={trail} />
          </Suspense>
        )
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

async function AwaitedTrail({ crumbs }: { crumbs: Promise<Crumb[]> }) {
  return <Trail crumbs={await crumbs} />;
}

function Trail({ crumbs }: { crumbs: Crumb[] }) {
  const t = useTranslations("admin.pageHeader");
  const parent = crumbs.at(-1);
  if (!parent) return null;
  return (
    <>
      <Link
        href={parent.href}
        aria-label={t("back", { label: parent.label })}
        className="-ml-1 inline-flex min-h-10 max-w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:hidden"
      >
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{parent.label}</span>
      </Link>
      <PageBreadcrumb items={crumbs} className="hidden md:block" />
    </>
  );
}
