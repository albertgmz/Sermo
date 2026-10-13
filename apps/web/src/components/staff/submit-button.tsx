"use client";

// SubmitButton: the submit button of a form with a server action. It is disabled while the action
// runs and, when `pendingLabel` is given, shows it in place of `label`. Used inside the form it
// submits.
//
// Props
//   label         The button's text.
//   pendingLabel  Text while the action runs. Default: `label`.
//   variant       The `Button` variant. Default: the button's own default.

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      className="min-h-10 px-4"
    >
      {pending ? (pendingLabel ?? label) : label}
    </Button>
  );
}
