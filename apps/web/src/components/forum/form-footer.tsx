"use client";

import { Save } from "lucide-react";
import Link from "next/link";
import { submitClass } from "@/components/forum/composer-buttons";
import { useSubmitTitle } from "@/components/forum/composer-submit";
import { FormError } from "@/components/forum/form-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The end of a page-sized form: the refusal, if any, then Cancel (a link back) and Submit, which
// saves, with XenForo's save icon, drawn as a composer's submit; Cancel as tall as it.
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
  const title = useSubmitTitle(submit);
  return (
    <>
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Link
          href={cancelHref}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 rounded-[9px] px-5 text-(length:--text-compact)",
          )}
        >
          {cancel}
        </Link>
        <Button
          type="submit"
          disabled={disabled}
          title={title}
          className={submitClass}
        >
          <Save aria-hidden="true" />
          {submit}
        </Button>
      </div>
    </>
  );
}
