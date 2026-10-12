import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../groups/skeletons";

type Search = Promise<{ notice?: string | string[] }>;

// The frame of a screen of the Economy section: the heading at once, the content streaming in
// below it behind skeletons that mirror a list and a form.
export function EconomyFrame({
  heading,
  subtitle,
  loading,
  children,
}: {
  heading: string;
  subtitle: string;
  loading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHead heading={heading} subtitle={subtitle} />
      <Suspense
        fallback={
          <LoadingRegion label={loading}>
            <div className="space-y-4">
              <ListSkeleton />
              <FormSkeleton />
            </div>
          </LoadingRegion>
        }
      >
        <div className="space-y-4">{children}</div>
      </Suspense>
    </div>
  );
}

// The confirmation a save redirected with, shown above the page's first panel. Only the notices
// the screen lists are shown; the text is the screen's own.
export async function EconomyNotice({
  searchParams,
  shown,
}: {
  searchParams: Search;
  shown: Record<string, string>;
}) {
  const { notice } = await searchParams;
  if (typeof notice !== "string" || !Object.hasOwn(shown, notice)) return null;
  return (
    <output className="block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium text-success">
      {shown[notice]}
    </output>
  );
}

// The first value of a search parameter, or "".
export const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";
