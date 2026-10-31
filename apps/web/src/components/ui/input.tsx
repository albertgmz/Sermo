import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import { FIELD_SURFACE, INPUT_CLASS } from "@/components/ui/field-surface";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(INPUT_CLASS, FIELD_SURFACE, className)}
      {...props}
    />
  );
}

export { Input };
