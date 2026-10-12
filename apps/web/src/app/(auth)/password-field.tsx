"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordField({
  id,
  name = "password",
  autoComplete,
  required,
  onValueChange,
}: {
  id: string;
  name?: string;
  autoComplete: string;
  required?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const t = useTranslations("auth.passwordField");
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex">
      <Input
        id={id}
        name={name}
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
        {visible ? t("hide") : t("show")}
      </Button>
    </div>
  );
}
