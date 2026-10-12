// A heading between groups of rows inside one settings form.
export function Subheading({
  heading,
  description,
}: {
  heading: string;
  description?: string;
}) {
  return (
    <div className="space-y-0.5 bg-muted/30 px-4 py-2.5">
      <h3 className="text-sm font-semibold">{heading}</h3>
      {description && (
        <p className="text-xs text-pretty text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
