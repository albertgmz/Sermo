import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The cursor of a list lives in the address, so each page of it is a page of its own.
export async function PageLinks({
  path,
  param,
  hash,
  cursor,
  next,
}: {
  path: string;
  param: "ignored" | "threads" | "forums";
  hash: string;
  cursor: string | undefined;
  next: string | null;
}) {
  if (!cursor && !next) return null;
  const t = await getTranslations("account.paging");
  const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2 border-t p-4">
      {cursor && (
        <Link href={`${path}#${hash}`} scroll={false} className={link}>
          {t("first")}
        </Link>
      )}
      {next && (
        <Link
          href={`${path}?${param}=${encodeURIComponent(next)}#${hash}`}
          scroll={false}
          className={link}
        >
          {t("next")}
        </Link>
      )}
    </nav>
  );
}
