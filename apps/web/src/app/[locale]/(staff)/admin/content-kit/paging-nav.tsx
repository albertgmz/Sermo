import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ListParams, listHref } from "@/components/staff/cursor-list";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The "first page" and "next" links under a list kept by cursor: the cursor lives in the address,
// as in `CursorList`, whose links these are.
export async function PagingNav({
  path,
  params,
  cursor,
  nextCursor,
}: {
  path: string;
  params: ListParams;
  cursor: string | undefined;
  nextCursor: string | null;
}) {
  if (!cursor && !nextCursor) return null;
  const t = await getTranslations("admin.cursorList");
  const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");
  return (
    <nav aria-label={t("nav")} className="flex flex-wrap gap-2">
      {cursor && (
        <Link href={listHref(path, params, "cursor")} className={link}>
          {t("first")}
        </Link>
      )}
      {nextCursor && (
        <Link
          href={listHref(path, params, "cursor", nextCursor)}
          rel="next"
          className={link}
        >
          {t("next")}
        </Link>
      )}
    </nav>
  );
}
