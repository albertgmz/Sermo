import { getTranslations } from "next-intl/server";

// Notice: the confirmation a save redirected with (`?notice=<name>`), shown above the page's first
// panel. A name the page does not accept shows nothing.
//
// Props
//   searchParams  The page's `searchParams`.
//   notices       The names the page accepts, each with its text.
//   namespace     Or, instead of `notices`: a message namespace of the panel whose keys are the
//   shown         notice names, and the names of it this page accepts.
export async function Notice({
  searchParams,
  ...accepted
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
} & (
  | { notices: Readonly<Record<string, string>> }
  | {
      namespace:
        | "adminAppearance.notices"
        | "adminForums.notices"
        | "adminGroups.notices"
        | "adminUsers.notices";
      shown: readonly string[];
    }
)) {
  const { notice } = await searchParams;
  if (typeof notice !== "string") return null;
  let text: string;
  if ("notices" in accepted) {
    if (!Object.hasOwn(accepted.notices, notice)) return null;
    text = accepted.notices[notice];
  } else {
    if (!accepted.shown.includes(notice)) return null;
    // Only names listed in `shown` get here; each is a key of the namespace.
    const t = (await getTranslations(accepted.namespace)) as unknown as (
      key: string,
    ) => string;
    text = t(notice);
  }
  return (
    <output className="block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium text-success">
      {text}
    </output>
  );
}
