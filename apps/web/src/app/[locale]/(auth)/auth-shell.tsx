import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { CubanFlag } from "@/components/brand/cuban-flag";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { getSite } from "@/lib/sermo/site";

// The frame every sign-in page shares: the Cuban flag with the site's name and a welcome, as a
// slim band above the form on a phone and a panel beside it from `md` up; the form in a narrow
// column, its heading the page's only h1.
function AuthFrame({
  site,
  heading,
  children,
}: {
  site: React.ReactNode;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh flex-1 grid-rows-[auto_1fr] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:grid-rows-1">
      <header className="relative isolate flex items-center gap-3 overflow-hidden bg-flag-night px-4 py-3 text-flag-white md:flex-col md:justify-center md:gap-8 md:px-10 md:text-center">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_90%_60%_at_50%_0%,color-mix(in_oklab,var(--flag-blue)_70%,transparent),transparent_70%)]"
        />
        <CubanFlag className="h-7 shrink-0 rounded-detail md:h-auto md:w-full md:max-w-72 md:rounded-md md:shadow-2xl" />
        <div className="min-w-0 md:space-y-2">{site}</div>
      </header>
      <main className="flex items-start justify-center px-4 py-8 md:items-center md:py-10">
        <div className="w-full max-w-sm">
          <h1 className="mb-6 text-center text-2xl font-bold tracking-tight md:mb-8 md:text-3xl">
            {heading}
          </h1>
          {children}
        </div>
      </main>
    </div>
  );
}

export async function AuthShell({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  const [t, shell, site] = await Promise.all([
    getTranslations("auth.login"),
    getTranslations("auth.shell"),
    getSite(),
  ]);
  return (
    <AuthFrame
      heading={heading}
      site={
        <>
          <Link
            href="/"
            aria-label={t("aria.home", { site: site.name })}
            className="block truncate rounded-sm text-lg leading-tight font-bold tracking-tight focus-visible:outline-flag-white md:text-3xl md:whitespace-normal"
          >
            {site.name}
          </Link>
          <p className="truncate text-xs text-flag-mist md:text-base md:whitespace-normal">
            {shell("welcome")}
          </p>
        </>
      }
    >
      {children}
    </AuthFrame>
  );
}

export function AuthShellSkeleton({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <AuthFrame
      heading={heading}
      site={
        <div className="space-y-1.5 md:flex md:flex-col md:items-center md:space-y-3">
          <Skeleton className="h-5 w-32 bg-flag-white/15 md:h-8 md:w-48" />
          <Skeleton className="h-3 w-44 bg-flag-white/10 md:h-4 md:w-60" />
        </div>
      }
    >
      {children}
    </AuthFrame>
  );
}

// A sign-in page while it loads: the frame with the page's heading over its placeholders, which
// screen readers hear as loading.
export function AuthShellLoading({
  page,
  children,
}: {
  page: "login" | "register" | "verify";
  children: React.ReactNode;
}) {
  const t = useTranslations("auth.loading");
  return (
    <AuthShellSkeleton heading={t(`${page}Heading`)}>
      <LoadingRegion label={t(`${page}Label`)}>{children}</LoadingRegion>
    </AuthShellSkeleton>
  );
}
