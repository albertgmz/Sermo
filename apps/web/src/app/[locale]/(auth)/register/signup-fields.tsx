import type { RegistrationField } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function Required({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

// The profile fields the site asks a new member for (its registration settings), one row each. Each
// is posted under its own name; `kept` is what was typed before a refusal.
export function SignupFields({
  fields,
  minimumAge,
  kept,
}: {
  fields: readonly RegistrationField[];
  minimumAge: number;
  kept: Record<string, string>;
}) {
  const t = useTranslations("auth.registerForm");
  // A date of birth cannot lie in the future.
  const today = new Date().toISOString().slice(0, 10);
  return fields.map((field) => {
    const id = `register-${field}`;
    const hint = field === "birthday" && minimumAge > 0;
    return (
      <div key={field} className="space-y-2">
        <Label htmlFor={id}>
          {t.rich(`fields.${field}`, {
            required: (chunks) => <Required>{chunks}</Required>,
          })}
        </Label>
        {field === "about" ? (
          <Textarea
            id={id}
            name={field}
            maxLength={5000}
            defaultValue={kept[field]}
            required
          />
        ) : (
          <Input
            id={id}
            name={field}
            type={
              field === "birthday"
                ? "date"
                : field === "website"
                  ? "url"
                  : "text"
            }
            {...(field === "birthday" ? { max: today } : {})}
            {...(field === "website" ? { maxLength: 200 } : {})}
            autoComplete={field === "birthday" ? "bday" : "off"}
            aria-describedby={hint ? `${id}-hint` : undefined}
            defaultValue={kept[field]}
            required
          />
        )}
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {t("minimumAge", { age: minimumAge })}
          </p>
        )}
      </div>
    );
  });
}
