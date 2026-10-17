import { ArrowUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BUTTON = "h-10 px-4 md:h-8 md:px-3";

// The "Add" link of a list page's header: the primary action.
export function AddLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(buttonVariants(), BUTTON)}>
      <Plus aria-hidden="true" />
      {children}
    </Link>
  );
}

// The "Sort" link of a list page's header, for a list with an order action.
export function SortLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant: "outline" }), BUTTON)}
    >
      <ArrowUpDown aria-hidden="true" />
      {children}
    </Link>
  );
}
