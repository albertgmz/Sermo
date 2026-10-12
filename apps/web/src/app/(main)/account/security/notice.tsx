import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

const FAILURES = ["revokeFailed", "resendFailed", "rateLimited"];

// The `notice` a mutation redirected with, if this section shows it.
export async function noticeOf(
  searchParams: Promise<{ notice?: string | string[] }>,
  shown: readonly string[],
) {
  const { notice } = await searchParams;
  return typeof notice === "string" && shown.includes(notice)
    ? notice
    : undefined;
}

export async function Notice({ notice }: { notice: string | undefined }) {
  if (!notice) return null;
  const t = await getTranslations("account.security.notices");
  return (
    <output
      className={cn(
        "block border-b px-4 py-2.5 text-xs font-medium",
        FAILURES.includes(notice) ? "text-destructive" : "text-success",
      )}
    >
      {t(notice as "revoked")}
    </output>
  );
}
