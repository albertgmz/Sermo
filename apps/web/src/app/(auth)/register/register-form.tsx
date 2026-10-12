"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { register } from "@/app/(auth)/actions";
import { PasswordField } from "@/app/(auth)/password-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const STRENGTH = ["weak", "weak", "fair", "good", "strong"];

function score(password: string) {
  return [/.{8,}/, /[a-z].*[A-Z]|[A-Z].*[a-z]/, /\d/, /[^A-Za-z0-9]/].filter(
    (rule) => rule.test(password),
  ).length;
}

function Required({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

export function RegisterForm({ referrer }: { referrer?: string }) {
  const t = useTranslations("auth.registerForm");
  const [state, action, pending] = useActionState(register, {
    error: "",
    username: "",
  });
  const [password, setPassword] = useState("");
  const strength = password ? score(password) : 0;

  return (
    <form action={action} className="space-y-4">
      {referrer && <input type="hidden" name="ref" value={referrer} />}
      <div className="space-y-2">
        <Label htmlFor="register-username">
          {t.rich("usernameLabel", {
            required: (chunks) => <Required>{chunks}</Required>,
          })}
        </Label>
        <Input
          id="register-username"
          name="username"
          autoComplete="username"
          defaultValue={state.username}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-email">
          {t.rich("emailLabel", {
            required: (chunks) => <Required>{chunks}</Required>,
          })}
        </Label>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-password">
          {t.rich("passwordLabel", {
            required: (chunks) => <Required>{chunks}</Required>,
          })}
        </Label>
        <PasswordField
          id="register-password"
          autoComplete="new-password"
          required
          onValueChange={setPassword}
        />
        <Progress
          value={strength * 25}
          aria-label={t("aria.passwordStrength")}
        />
        <p className="text-xs text-muted-foreground">
          {password
            ? t("passwordStrength", { strength: STRENGTH[strength] })
            : t("errors.passwordRequired")}
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {t("submit")}
      </Button>
      <div className="flex min-h-10 items-center gap-2 md:min-h-0">
        <Checkbox id="register-terms" name="terms" />
        <Label
          htmlFor="register-terms"
          className="block leading-normal font-normal text-muted-foreground"
        >
          {t.rich("terms", {
            terms: (chunks) => (
              <Link href="/terms" className="font-medium text-foreground">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href="/privacy" className="font-medium text-foreground">
                {chunks}
              </Link>
            ),
          })}
        </Label>
      </div>
    </form>
  );
}
