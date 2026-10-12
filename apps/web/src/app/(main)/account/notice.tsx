import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

export type SearchParams = Promise<{
  notice?: string | string[];
  // Cursors of the lists on the pages that have them.
  ignored?: string | string[];
  threads?: string | string[];
  forums?: string | string[];
}>;

export const cursorOf = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

const FAILURES = ["failed"];

// The `notice` a mutation redirected with, if this section shows it.
export async function noticeOf(
  searchParams: SearchParams,
  shown: readonly string[],
) {
  const { notice } = await searchParams;
  return typeof notice === "string" && shown.includes(notice)
    ? notice
    : undefined;
}

export async function Notice({ notice }: { notice: string | undefined }) {
  if (!notice) return null;
  const t = await getTranslations("account.notices");
  return (
    <output
      className={cn(
        "block border-b px-4 py-2.5 text-xs font-medium",
        FAILURES.includes(notice) ? "text-destructive" : "text-success",
      )}
    >
      {t(notice as "avatar")}
    </output>
  );
}
