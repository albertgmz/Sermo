import { Button } from "@/components/ui/button";

// The last line of a form of the permission screens that asks for a page (a GET form laid out
// as a `FieldGroup`): its button, then an optional line beside it.
export function SubmitRow({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <Button type="submit" disabled={disabled} className="min-h-10 px-4">
        {label}
      </Button>
      {children}
    </div>
  );
}
