import Link from "next/link";
import { Suspense } from "react";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { liteBlocks } from "@/lib/lite-mode";
import { cn } from "@/lib/utils";

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
    <LogoLink {...props}>
      <LogoMark />
    </LogoLink>
  );
}

export function LogoPlaceholder(props: LogoProps) {
  return (
    <LogoLink {...props}>
      <LogoMarkPlaceholder />
    </LogoLink>
  );
}

function LogoLink({
  href = "/",
  markOnly = false,
  className,
  children,
}: LogoProps & {
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label="forum/ui home"
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-md font-bold tracking-tight",
        className,
      )}
    >
      {children}
      {!markOnly && <span>forum/ui</span>}
    </Link>
  );
}
