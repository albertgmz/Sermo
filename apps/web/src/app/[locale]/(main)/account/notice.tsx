import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

export type SearchParams = Promise<{
  notice?: string | string[];
  // A refusal names the control that was pressed and carries the backend's words.
  where?: string | string[];
  message?: string | string[];
  // Cursors of the lists on the pages that have them.
  ignored?: string | string[];
  threads?: string | string[];
  forums?: string | string[];
}>;

export const cursorOf = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

export type Shown = { key: string; message?: string };

const MESSAGE_MAX = 300;

// Where a mutation sends the member when the backend refused it: the section of the control
// that was pressed shows the refusal, and no other.
export function failedPath(path: string, hash: string, message: string) {
  const params = new URLSearchParams({
    notice: "failed",
    where: hash,
    message: message.slice(0, MESSAGE_MAX),
  });
  return `${path}?${params}#${hash}`;
}

// The `notice` a mutation redirected with, if this section shows it. A refusal is shown by the
// section that owns the control named in `where`.
export async function noticeOf(
  searchParams: SearchParams,
  shown: readonly string[],
  owns: readonly string[] = [],
): Promise<Shown | undefined> {
  const { notice, where, message } = await searchParams;
  if (typeof notice !== "string") return undefined;
  if (notice === "failed") {
    if (typeof where !== "string" || !owns.includes(where)) return undefined;
    return {
      key: notice,
      message:
        typeof message === "string" && message
          ? message.slice(0, MESSAGE_MAX)
          : undefined,
    };
  }
  return shown.includes(notice) ? { key: notice } : undefined;
}

export async function Notice({ notice }: { notice: Shown | undefined }) {
  if (!notice) return null;
  const t = await getTranslations("account.notices");
  return (
    <output
      className={cn(
        "block border-b px-4 py-2.5 text-xs font-medium [overflow-wrap:anywhere]",
        notice.key === "failed" ? "text-destructive" : "text-success",
      )}
    >
      {notice.message ?? t(notice.key as "username")}
    </output>
  );
}
