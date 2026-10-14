// The pieces of a list of editable entries in the administration panel. Server-safe.
//
// EditDisclosure: one entry as a closed details block; the summary shows `summary` and, at its
// end, the `edit` label; opening it shows `children` (the editor, then a `DeleteBox`).
//   summary        The entry's description.
//   edit           Label at the end of the summary.
//   summaryClass   Extra classes of the summary (its minimum height).
//   className      Optional classes of the details element.
//
// DeleteBox: the bordered frame around the `ConfirmStep` that deletes the entry. Its children
// are that `ConfirmStep`.

export function EditDisclosure({
  summary,
  edit,
  summaryClass,
  className,
  children,
}: {
  summary: React.ReactNode;
  edit: React.ReactNode;
  summaryClass: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={className}>
      <summary
        className={`flex ${summaryClass} cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2`}
      >
        {summary}
        <span className="ms-auto text-sm font-medium text-primary-ink">
          {edit}
        </span>
      </summary>
      <div className="space-y-4 border-t p-4">{children}</div>
    </details>
  );
}

export function DeleteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/30 px-4 py-1">
      {children}
    </div>
  );
}

// EntryList: the panel of a list of editable entries.
//   heading      The panel's heading, also the list's label.
//   description  Optional line under the heading.
//   none         The line shown when there are no entries.
//   items        The entries, each an `li`.
export function EntryList({
  heading,
  description,
  none,
  items,
}: {
  heading: string;
  description?: string;
  none: string;
  items: React.ReactNode[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{heading}</h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {items.length > 0 ? (
        <ul aria-label={heading} className="divide-y">
          {items}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{none}</p>
      )}
    </section>
  );
}
