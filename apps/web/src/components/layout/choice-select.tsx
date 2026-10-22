"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChoiceOption = { value: string; label: string; lang?: string };

// The one dropdown for a visitor's settings (theme, language): a native select shown as a button
// with the current choice, so the keyboard, touch pickers and screen readers are the browser's own
// and no script is needed to draw it. With `submitOnChange` inside a form, picking an option posts
// the form (the form's own button does the same when scripts are off).
export function ChoiceSelect({
  label,
  icon: Icon,
  options,
  value,
  name,
  onChange,
  submitOnChange = false,
  className,
}: {
  label: string;
  icon: LucideIcon;
  options: ChoiceOption[];
  value: string;
  name?: string;
  onChange?: (value: string) => void;
  submitOnChange?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center text-muted-foreground focus-within:text-foreground hover:text-foreground",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 size-4"
      />
      <select
        aria-label={label}
        name={name}
        value={value}
        onChange={(event) => {
          onChange?.(event.currentTarget.value);
          if (submitOnChange) event.currentTarget.form?.requestSubmit();
        }}
        className="min-h-10 cursor-pointer appearance-none rounded-lg border bg-background py-1 pr-8 pl-8 text-sm font-medium text-foreground md:min-h-8"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} lang={option.lang}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 size-4"
      />
    </span>
  );
}
