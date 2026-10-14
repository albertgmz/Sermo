"use client";

import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";

const STRENGTH = ["weak", "weak", "fair", "good", "strong"];

function score(password: string) {
  return [/.{8,}/, /[a-z].*[A-Z]|[A-Z].*[a-z]/, /\d/, /[^A-Za-z0-9]/].filter(
    (rule) => rule.test(password),
  ).length;
}

export function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations("auth.passwordStrength");
  const strength = password ? score(password) : 0;
  return (
    <>
      <Progress value={strength * 25} aria-label={t("aria")} />
      <p className="text-xs text-muted-foreground">
        {password ? t("label", { strength: STRENGTH[strength] }) : t("empty")}
      </p>
    </>
  );
}
