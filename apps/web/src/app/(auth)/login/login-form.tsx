"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { login } from "@/app/(auth)/actions";
import { GoogleIcon } from "@/app/(auth)/google-icon";
import { PasswordField } from "@/app/(auth)/password-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const t = useTranslations("auth.loginForm");
  const [state, action, pending] = useActionState(login, {
    error: "",
    username: "",
  });

  return (
    <form action={action} className="space-y-4">
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full text-muted-foreground md:h-8"
      >
        <GoogleIcon />
        {t("provider")}
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("separator")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-username">{t("usernameLabel")}</Label>
        <Input
          id="login-username"
          name="username"
          autoComplete="username"
          defaultValue={state.username}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "login-error" : undefined}
        />
        {state.error && (
          <p id="login-error" role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">{t("passwordLabel")}</Label>
        <PasswordField id="login-password" autoComplete="current-password" />
        <Link
          href="#"
          className="inline-flex min-h-10 items-center text-sm underline-offset-4 hover:underline md:min-h-0"
        >
          {t("forgotPassword")}
        </Link>
      </div>
      <div className="flex min-h-10 items-center gap-2 md:min-h-0">
        <Checkbox id="login-stay" name="remember" defaultChecked />
        <Label htmlFor="login-stay" className="font-normal">
          {t("rememberLabel")}
        </Label>
      </div>
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {t("submit")}
      </Button>
    </form>
  );
}
