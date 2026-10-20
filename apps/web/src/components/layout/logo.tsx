import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import { liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { APP_ICON_URL } from "@/lib/pwa";
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

// The square mark: the site's icon when there is one (it is square), else its logo, else the
// drawn mark. A picture is drawn larger than the line mark, so a full-colour mark stays legible on
// a phone's header.
async function Mark({
  site,
  className,
}: {
  site: SiteIdentity;
  className?: string;
}) {
  const picture = site.icon
    ? {
        image: site.icon,
        blocked: await liteBlocks(liteCategoryOfPurpose("site_icon")),
      }
    : site.logo
      ? {
          image: site.logo,
          blocked: await liteBlocks(liteCategoryOfPurpose("site_logo")),
        }
      : null;
  if (picture) {
    if (picture.blocked)
      return <LogoMarkPlaceholder className={cn("size-8", className)} />;
    return (
      // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
      <img
        src={picture.image.url}
        alt={site.name}
        className={cn("size-8 object-contain", className)}
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

// The app's icon as a home screen shows it, for the cards that offer the app: the uploaded icon,
// else the default mark of the manifest (`/pwa-icon/192`). Decorative: the card's title names the
// site.
export async function AppIcon({ className }: { className?: string }) {
  const site = await getSite();
  const box = cn("size-full object-cover", className);
  if (site.icon) {
    if (await liteBlocks(liteCategoryOfPurpose("site_icon")))
      return <LitePlaceholder compact className={box} />;
    // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
    return <img src={site.icon.url} alt="" className={box} />;
  }
  if (await liteBlocks("brand"))
    return <LitePlaceholder compact className={box} />;
  // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
  return <img src={APP_ICON_URL} alt="" className={box} />;
}

type LogoProps = {
  href?: string;
  markOnly?: boolean;
  // Below `lg`, room for the header's other buttons: a drawn logo shows its mark only, a picture
  // is capped narrower (its proportions kept).
  compact?: boolean;
  className?: string;
};

// What `compact` changes below `lg`.
const COMPACT_TEXT = "max-lg:w-10 max-lg:justify-center";
const COMPACT_NAME = "max-lg:hidden";
const COMPACT_PICTURE = "max-lg:max-w-18";

export function Logo(props: LogoProps) {
  return (
    <Suspense fallback={<LogoPlaceholder {...props} />}>
      <ResolvedLogo {...props} />
    </Suspense>
  );
}

// The name is not known yet, so its text is a bar; the box is the one the link settles into.
export function LogoPlaceholder({
  markOnly = false,
  compact = false,
  className,
}: LogoProps) {
  return (
    <span className={cn(LINK_BOX, compact && COMPACT_TEXT, className)}>
      <LogoMarkPlaceholder />
      {!markOnly && (
        <Skeleton className={cn("h-4 w-16", compact && COMPACT_NAME)} />
      )}
    </span>
  );
}

async function ResolvedLogo({
  href = "/",
  markOnly = false,
  compact = false,
  className,
}: LogoProps) {
  const site = await getSite();
  const picture =
    site.logo &&
    !markOnly &&
    !(await liteBlocks(liteCategoryOfPurpose("site_logo")));
  return (
    <LogoLink
      href={href}
      name={site.name}
      className={cn(compact && !picture && COMPACT_TEXT, className)}
    >
      {site.logo && picture ? (
        // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
        <img
          src={site.logo.url}
          alt={site.name}
          className={cn(
            "h-6 w-auto max-w-40 object-contain object-left",
            compact && COMPACT_PICTURE,
          )}
        />
      ) : (
        <>
          <Mark site={site} />
          {!markOnly && (
            <span className={compact ? COMPACT_NAME : undefined}>
              {site.name}
            </span>
          )}
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
