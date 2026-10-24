import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AuthScene } from "@/app/[locale]/(auth)/auth-scene";
import { CubanFlag } from "@/components/brand/cuban-flag";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { getSite } from "@/lib/sermo/site";

// The frame every sign-in page shares: the Cuban flag with the site's name and a welcome over a
// night at the Malecón whose sea gives off bubbles of talk (auth-scene.tsx), as a band above the
// form on a phone (the bubbles rise right of the name) and a panel beside it from `md` up; the form in a narrow column, on a card from
// `md` up, its heading the page's only h1.
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
      <header className="relative isolate grid grid-cols-[auto_minmax(0,1fr)] content-center items-center gap-x-3 gap-y-2 overflow-hidden bg-flag-night px-4 pt-5 pb-12 text-flag-white md:flex md:flex-col md:justify-center md:gap-8 md:px-10 md:pb-28 md:text-center">
        <AuthScene />
        <span className="auth-flag h-9 md:h-auto md:w-full md:max-w-72">
          <CubanFlag className="h-full rounded-detail shadow-lg md:h-auto md:w-full md:rounded-md md:shadow-2xl" />
        </span>
        <div className="contents [text-shadow:0_1px_0.75rem_var(--flag-night)] md:block md:w-full md:space-y-2">
          {site}
        </div>
      </header>
      <main className="relative isolate flex items-start justify-center px-4 py-8 md:items-center md:py-10">
        <div aria-hidden="true" className="auth-backdrop max-md:hidden" />
        <div className="w-full max-w-sm md:max-w-[26rem] md:rounded-2xl md:border md:bg-card md:p-8 md:shadow-xl">
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
            className="block w-fit max-w-full truncate rounded-sm text-xl leading-tight font-bold tracking-tight focus-visible:outline-flag-white md:mx-auto md:text-4xl md:whitespace-normal"
          >
            {site.name}
          </Link>
          <p className="col-span-2 max-w-[56%] text-xs text-flag-mist md:max-w-none md:text-base">
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
        <div className="flex flex-col items-start space-y-1.5 md:items-center md:space-y-3">
          <Skeleton className="h-6 w-32 bg-flag-white/15 md:h-10 md:w-56" />
          <Skeleton className="h-3 w-44 bg-flag-white/10 md:h-5 md:w-64" />
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
