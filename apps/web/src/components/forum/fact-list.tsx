// A card's list of facts: each a label and its value on one row, the label at the start and the
// value at the end. The label keeps its width and the value its room (a long one wraps), so a
// name is never cut to two letters when the row has the space.
export function FactList({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-border">{children}</dl>;
}

export function Fact({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium tabular-nums [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}
