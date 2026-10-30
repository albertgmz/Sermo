import type { SocialProvider } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import { signInWith } from "@/app/[locale]/(auth)/social-actions";
import { providerName } from "@/app/[locale]/(auth)/social-refusal";
import { FormError } from "@/components/forum/form-error";
import { GoogleMark, SocialIcon } from "@/components/forum/social-icon";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Page = "/login" | "/register";

// One provider's button: a plain form, so it works before the page's script has loaded too. The
// action sends the browser to the provider (`signInWith`).
function ProviderForm({
  provider,
  from,
  next,
  children,
}: {
  provider: SocialProvider;
  from: Page;
  next: string;
  children: React.ReactNode;
}) {
  return (
    <form action={signInWith}>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="next" value={next} />
      {children}
    </form>
  );
}

// Google's button as its branding guidelines draw it: its own fill, outline and text colour per
// theme (globals.css), 40 px tall, the "G" 12 px from the left edge on a white ground, the label
// centred. The guidelines want it at least as prominent as any other provider's.
const GOOGLE_BUTTON =
  "relative flex h-10 w-full items-center justify-center rounded-lg border border-google-stroke bg-google-fill px-12 text-sm font-medium text-google-text outline-none transition-colors hover:bg-google-fill-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px";

// The sign-in providers that are on, above the password form of the sign-in and sign-up pages:
// Google across the full width, GitHub and X smaller and side by side under it, then the "or" that
// leads to the form. Nothing at all while no provider is on. `refusal` is what a provider sign-in
// that came back refused says (`social-refusal.ts`).
export function SocialSignIn({
  providers,
  from,
  next,
  refusal,
}: {
  providers: readonly SocialProvider[];
  from: Page;
  next: string;
  refusal?: string;
}) {
  const t = useTranslations("auth.social");
  if (providers.length === 0) return null;
  const others = providers.filter((provider) => provider !== "google");
  return (
    <div className="mb-4 space-y-3">
      {refusal && <FormError>{refusal}</FormError>}
      {providers.includes("google") && (
        <ProviderForm provider="google" from={from} next={next}>
          <button type="submit" className={GOOGLE_BUTTON}>
            <span className="absolute left-[9px] flex size-6 items-center justify-center rounded-full bg-google-logo-ground">
              <GoogleMark />
            </span>
            {t("google")}
          </button>
        </ProviderForm>
      )}
      {others.length > 0 && (
        <div className={cn("grid gap-3", others.length > 1 && "grid-cols-2")}>
          {others.map((provider) => (
            <ProviderForm
              key={provider}
              provider={provider}
              from={from}
              next={next}
            >
              <button
                type="submit"
                aria-label={t("continueWith", {
                  provider: providerName(provider),
                })}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-10 w-full gap-2 md:h-9",
                )}
              >
                <SocialIcon network={provider === "github" ? "github" : "x"} />
                {providerName(provider)}
              </button>
            </ProviderForm>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        {t("or")}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
