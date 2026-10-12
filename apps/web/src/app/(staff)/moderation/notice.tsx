import { getTranslations } from "next-intl/server";

type Params = Promise<{ notice?: string | string[] }>;

const NOTICES = ["stateSaved", "approved", "rejected"] as const;

// The confirmation a decision redirected with, shown above the page's first panel.
export async function Notice({ searchParams }: { searchParams: Params }) {
  const { notice } = await searchParams;
  const shown = NOTICES.find((name) => name === notice);
  if (!shown) return null;
  const t = await getTranslations("moderation.notices");
  return (
    <output className="block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium text-success">
      {t(shown)}
    </output>
  );
}
