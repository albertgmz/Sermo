import { isPublished } from "@/lib/sermo/pages";

// What the terms checkbox names: only the pages the site publishes.
export async function termsPages(): Promise<
  "both" | "terms" | "rules" | "none"
> {
  const [hasTerms, hasRules] = await Promise.all([
    isPublished("terms"),
    isPublished("rules"),
  ]);
  return hasTerms && hasRules
    ? "both"
    : hasTerms
      ? "terms"
      : hasRules
        ? "rules"
        : "none";
}
