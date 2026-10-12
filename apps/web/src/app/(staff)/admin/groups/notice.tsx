import { getTranslations } from "next-intl/server";

type Params = Promise<{ notice?: string | string[] }>;

// The confirmation a save redirected with, shown above the page's first panel.
export async function Notice({
  searchParams,
  shown,
}: {
  searchParams: Params;
  shown: readonly string[];
}) {
  const { notice } = await searchParams;
  if (typeof notice !== "string" || !shown.includes(notice)) return null;
  const t = await getTranslations("adminGroups.notices");
  return (
    <output className="block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium text-success">
      {t(notice as "saved")}
    </output>
  );
}
