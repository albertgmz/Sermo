"use client";

import { useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";

export function LiteCheckbox(props: {
  id: string;
  name?: string;
  value?: string;
  defaultChecked: boolean;
  disabled?: boolean;
  "aria-labelledby": string;
  "aria-describedby": string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [initialChecked, setInitialChecked] = useState<boolean | null>(null);

  useEffect(() => {
    if (input.current) setInitialChecked(input.current.checked);
  }, []);

  // Preserve edits made to the native control before Base UI takes over.
  return initialChecked !== null ? (
    <Checkbox {...props} defaultChecked={initialChecked} />
  ) : (
    <input
      ref={input}
      type="checkbox"
      className="size-4 accent-primary"
      {...props}
    />
  );
}
