import Link from "next/link";
import { Suspense } from "react";
import { Notice } from "@/components/staff/notice";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// What a permission matrix page shows above its form: the confirmation of a save, then the name
// of whose permissions these are.
export function MatrixHead({
  searchParams,
  title,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
  title: string;
}) {
  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["saved"]}
      />
      <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {title}
      </h2>
    </>
  );
}

// A matrix page's header action: a link to a neighbouring page, drawn once its address is known
// (from the page's params and, for a gated page, the viewer); null draws nothing.
export function MatrixAction({
  href,
  label,
}: {
  href: Promise<string | null>;
  label: string;
}) {
  return (
    <Suspense fallback={<Skeleton className="h-10 w-32" />}>
      <AwaitedAction href={href} label={label} />
    </Suspense>
  );
}

async function AwaitedAction({
  href,
  label,
}: {
  href: Promise<string | null>;
  label: string;
}) {
  const target = await href;
  if (!target) return null;
  return (
    <Link
      href={target}
      className={cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4")}
    >
      {label}
    </Link>
  );
}
