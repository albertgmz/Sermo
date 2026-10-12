type Params = Promise<{ notice?: string | string[] }>;

// The confirmation a save redirected with, shown above the page's first panel. `notices` maps the
// notice names the page accepts to their text, so an unknown value shows nothing.
export async function Notice({
  searchParams,
  notices,
}: {
  searchParams: Params;
  notices: Readonly<Record<string, string>>;
}) {
  const { notice } = await searchParams;
  if (typeof notice !== "string" || !Object.hasOwn(notices, notice)) {
    return null;
  }
  return (
    <output className="block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium text-success">
      {notices[notice]}
    </output>
  );
}
