import { ChevronDown, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The next page of a list: a link, so it works without scripts and the page stays a page.
// `scroll` and `icon` are for the conversation page's earlier/newest links, which scroll and point up.
export function LoadMore({
  href,
  children,
  className,
  icon: Icon = ChevronDown,
  scroll = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
  scroll?: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={scroll}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-10 w-full",
        className,
      )}
    >
      <Icon />
      {children}
    </Link>
  );
}
