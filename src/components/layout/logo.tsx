import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
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

export function Logo({
  href = "/",
  markOnly = false,
  className,
}: {
  href?: string;
  markOnly?: boolean;
  className?: string;
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
      <LogoMark />
      {!markOnly && <span>forum/ui</span>}
    </Link>
  );
}
