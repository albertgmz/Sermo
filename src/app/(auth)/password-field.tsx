"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordField({
  id,
  autoComplete,
  required,
  onValueChange,
}: {
  id: string;
  autoComplete: string;
  required?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex">
      <Input
        id={id}
        name="password"
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        onChange={(event) => onValueChange?.(event.target.value)}
        className="rounded-r-none"
      />
      <Button
        type="button"
        variant="outline"
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
        className="h-10 w-20 rounded-l-none border-l-0 text-muted-foreground md:h-8"
      >
        {visible ? <EyeOff /> : <Eye />}
        {visible ? "Hide" : "Show"}
      </Button>
    </div>
  );
}
