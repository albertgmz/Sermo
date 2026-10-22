import { Save } from "lucide-react";
import Link from "next/link";
import { FormError } from "@/components/forum/form-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The end of a page-sized form: the refusal, if any, then Cancel (a link back) and Submit, which
// saves, with XenForo's save icon.
export function FormFooter({
  error,
  cancelHref,
  cancel,
  submit,
  disabled,
}: {
  error?: string;
  cancelHref: string;
  cancel: string;
  submit: string;
  disabled: boolean;
}) {
  return (
    <>
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Link
          href={cancelHref}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
        >
          {cancel}
        </Link>
        <Button type="submit" disabled={disabled} className="h-10 px-4">
          <Save aria-hidden="true" />
          {submit}
        </Button>
      </div>
    </>
  );
}
