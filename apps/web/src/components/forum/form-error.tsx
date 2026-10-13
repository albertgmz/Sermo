import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The refusal a form shows under its fields: an alert, announced at once. A polite status line
// (`<output>`) is a different thing and stays separate.
export function FormError({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={cn("text-sm text-destructive", className)}
    >
      {children}
    </p>
  );
}
