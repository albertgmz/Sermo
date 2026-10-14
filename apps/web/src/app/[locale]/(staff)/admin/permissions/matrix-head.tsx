import Link from "next/link";
import { Notice } from "@/components/staff/notice";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// What a permission matrix page shows above its form: the confirmation of a save, then the name
// of whose permissions these are with, when the viewer may use it, a link to a neighbouring page.
export function MatrixHead({
  searchParams,
  title,
  link,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
  title: string;
  link?: { href: string; label: string };
}) {
  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["saved"]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
        {link && (
          <Link
            href={link.href}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-10 px-4",
            )}
          >
            {link.label}
          </Link>
        )}
      </div>
    </>
  );
}
