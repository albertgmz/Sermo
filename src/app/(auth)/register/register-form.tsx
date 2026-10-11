"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { register } from "@/app/(auth)/actions";
import { GoogleIcon } from "@/app/(auth)/google-icon";
import { PasswordField } from "@/app/(auth)/password-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const STRENGTH = ["Weak", "Weak", "Fair", "Good", "Strong"];

function score(password: string) {
  return [/.{8,}/, /[a-z].*[A-Z]|[A-Z].*[a-z]/, /\d/, /[^A-Za-z0-9]/].filter(
    (rule) => rule.test(password),
  ).length;
}

function Required() {
  return <span className="text-xs text-muted-foreground">Required</span>;
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, {
    error: "",
    username: "",
  });
  const [password, setPassword] = useState("");
  const strength = password ? score(password) : 0;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="register-username">
          Username: <Required />
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
          Email: <Required />
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
          Password: <Required />
        </Label>
        <PasswordField
          id="register-password"
          autoComplete="new-password"
          required
          onValueChange={setPassword}
        />
        <Progress value={strength * 25} aria-label="Password strength" />
        <p className="text-xs text-muted-foreground">
          {password
            ? `Password strength: ${STRENGTH[strength]}`
            : "Entering a password is required."}
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        Create Account
      </Button>
      <div className="flex min-h-10 items-center gap-2 md:min-h-0">
        <Checkbox id="register-terms" name="terms" />
        <Label
          htmlFor="register-terms"
          className="block leading-normal font-normal text-muted-foreground"
        >
          I agree to the{" "}
          <Link href="/terms" className="font-medium text-foreground">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-foreground">
            privacy policy
          </Link>
          .
        </Label>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR CONTINUE WITH
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="h-10 w-full md:h-8">
        <GoogleIcon />
        Google
      </Button>
    </form>
  );
}
