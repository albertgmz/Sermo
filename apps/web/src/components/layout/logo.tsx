import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import { liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { getSite, type SiteIdentity } from "@/lib/sermo/site";
import { cn } from "@/lib/utils";

const LINK_BOX =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md font-bold tracking-tight";

export function LogoMark({ className }: { className?: string }) {
  return (
    <Suspense fallback={<LogoMarkPlaceholder className={className} />}>
      <ResolvedLogoMark className={className} />
    </Suspense>
  );
}

export function LogoMarkPlaceholder({ className }: { className?: string }) {
  return <LitePlaceholder compact className={cn("size-5", className)} />;
}

async function ResolvedLogoMark({ className }: { className?: string }) {
  return <Mark site={await getSite()} className={className} />;
}

// The square mark: the site's own picture when there is one, else the drawn mark.
async function Mark({
  site,
  className,
}: {
  site: SiteIdentity;
  className?: string;
}) {
  if (site.logo) {
    if (await liteBlocks(liteCategoryOfPurpose("site_logo")))
      return <LogoMarkPlaceholder className={className} />;
    return (
      // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
      <img
        src={site.logo.url}
        alt={site.name}
        className={cn("size-5 object-contain", className)}
      />
    );
  }
  if (await liteBlocks("brand"))
    return <LogoMarkPlaceholder className={className} />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className={cn("size-5", className)}
    >
      <path d="M5 19 15 5" />
      <path d="m13 19 6-8" />
    </svg>
  );
}

type LogoProps = {
  href?: string;
  markOnly?: boolean;
  className?: string;
};

export function Logo(props: LogoProps) {
  return (
    <Suspense fallback={<LogoPlaceholder {...props} />}>
      <ResolvedLogo {...props} />
    </Suspense>
  );
}

// The name is not known yet, so its text is a bar; the box is the one the link settles into.
export function LogoPlaceholder({ markOnly = false, className }: LogoProps) {
  return (
    <span className={cn(LINK_BOX, className)}>
      <LogoMarkPlaceholder />
      {!markOnly && <Skeleton className="h-4 w-16" />}
    </span>
  );
}

async function ResolvedLogo({
  href = "/",
  markOnly = false,
  className,
}: LogoProps) {
  const site = await getSite();
  const picture =
    site.logo &&
    !markOnly &&
    !(await liteBlocks(liteCategoryOfPurpose("site_logo")));
  return (
    <LogoLink href={href} name={site.name} className={className}>
      {site.logo && picture ? (
        // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
        <img
          src={site.logo.url}
          alt={site.name}
          className="h-6 w-auto max-w-40 object-contain object-left"
        />
      ) : (
        <>
          <Mark site={site} />
          {!markOnly && <span>{site.name}</span>}
        </>
      )}
    </LogoLink>
  );
}

function LogoLink({
  href,
  name,
  className,
  children,
}: {
  href: string;
  name: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("layout.logo");
  return (
    <Link
      href={href}
      aria-label={t("aria.home", { site: name })}
      className={cn(LINK_BOX, className)}
    >
      {children}
    </Link>
  );
}
