import Link from "next/link";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The word after a required field's label.
export function Required({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

// The username of a new account: the sign-up form's, and the username screen of an account a
// sign-in provider made.
export function UsernameField({ defaultValue }: { defaultValue: string }) {
  const t = useTranslations("auth.registerForm");
  return (
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
        defaultValue={defaultValue}
        required
      />
    </div>
  );
}

// The box a new member ticks to accept the terms and rules, naming and linking only the pages the
// site publishes (`pages`), and the privacy policy. `newTab` opens them in a new tab, so the form
// keeps what was typed.
export function TermsField({
  pages,
  newTab = false,
}: {
  pages: "both" | "terms" | "rules" | "none";
  newTab?: boolean;
}) {
  const t = useTranslations("auth.registerForm");
  const target = newTab ? { target: "_blank" } : {};
  return (
    <div className="flex min-h-10 items-center gap-2 md:min-h-0">
      <Checkbox id="register-terms" name="terms" />
      <Label
        htmlFor="register-terms"
        className="block leading-normal font-normal text-muted-foreground"
      >
        {t.rich("terms", {
          pages,
          terms: (chunks) => (
            <Link
              href="/terms"
              {...target}
              className="font-medium text-foreground"
            >
              {chunks}
            </Link>
          ),
          rules: (chunks) => (
            <Link
              href="/rules"
              {...target}
              className="font-medium text-foreground"
            >
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link
              href="/privacy"
              {...target}
              className="font-medium text-foreground"
            >
              {chunks}
            </Link>
          ),
        })}
      </Label>
    </div>
  );
}
