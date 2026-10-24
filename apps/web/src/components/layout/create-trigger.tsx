import { Plus } from "lucide-react";

// The Create button is the round + of the bottom bar, drawn below `md`. A member starts a thread on
// a wide screen from the forum's own New thread button.
//
// The plain button and the one that opens the dialog look the same, so one swaps for the other
// without a jump.
export const TRIGGER_CLASS =
  "flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors outline-none hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring md:hidden";

export function TriggerContent() {
  return <Plus aria-hidden="true" className="size-6" />;
}
