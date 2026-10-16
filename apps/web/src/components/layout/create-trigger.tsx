import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Where the Create button is drawn: a labelled button in the header from `md` up, the round + of
// the bottom bar below it.
export type CreateVariant = "header" | "bar";

// The plain button and the one that opens the dialog look the same, so one swaps for the other
// without a jump.
export function triggerClass(variant: CreateVariant) {
  return variant === "header"
    ? cn(buttonVariants(), "hidden px-3 md:inline-flex")
    : "flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors outline-none hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring md:hidden";
}

export function TriggerContent({
  variant,
  label,
}: {
  variant: CreateVariant;
  label: string;
}) {
  return variant === "header" ? (
    <>
      <Plus aria-hidden="true" />
      {label}
    </>
  ) : (
    <Plus aria-hidden="true" className="size-6" />
  );
}
