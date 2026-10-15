"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Checkbox } from "@/components/ui/checkbox";

// While the form's action is pending the controls refuse changes: the page is
// rebuilt from server state when the save lands, and an edit made in between
// would be discarded. The submitted FormData was captured before the pending
// state rendered, so disabling here does not drop fields from the submission.
export function LiteCheckbox({
  disabled,
  ...props
}: {
  id: string;
  name?: string;
  value?: string;
  defaultChecked: boolean;
  disabled?: boolean;
  "aria-labelledby": string;
  "aria-describedby": string;
}) {
  const { pending } = useFormStatus();
  const input = useRef<HTMLInputElement>(null);
  const [initialChecked, setInitialChecked] = useState<boolean | null>(null);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    // Follow the native control until the Base UI one replaces it, so a tick
    // between this effect and that commit reaches the replacement.
    const sync = () => setInitialChecked(element.checked);
    sync();
    element.addEventListener("change", sync);
    return () => element.removeEventListener("change", sync);
  }, []);

  const locked = disabled || pending;
  // Preserve edits made to the native control before Base UI takes over.
  return initialChecked !== null ? (
    <Checkbox
      {...props}
      defaultChecked={initialChecked}
      disabled={locked}
      className={pending ? "cursor-not-allowed opacity-50" : undefined}
    />
  ) : (
    <input
      ref={input}
      type="checkbox"
      className="size-4 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      disabled={locked}
      {...props}
    />
  );
}
