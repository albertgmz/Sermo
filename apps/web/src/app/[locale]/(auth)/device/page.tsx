import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { decideDevice } from "@/app/[locale]/(auth)/device/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readDeviceRequest } from "@/lib/sermo/auth";
import { getMember } from "@/lib/sermo/session";

// The address carries the code: it must not travel on in a Referer header.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.device");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value.trim() : "";

// The code as a terminal shows it: two groups of four, whatever the member typed.
const shown = (code: string) =>
  /^[A-Za-z0-9]{8}$/.test(code)
    ? `${code.slice(0, 4)}-${code.slice(4)}`.toUpperCase()
    : code;

const linkClass =
  "inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline";

// Where a terminal client (sermo-cli) sends its member to approve a device login: the code comes
// in the address (`verification_uri_complete`) or is typed here. A visitor who is not signed in
// signs in first (with a password or a provider) and comes back. Every decision is the backend's:
// the page reads the request for the member (which claims the code for them) and the buttons send
// the answer through server actions, so it works without JavaScript.
export default async function DevicePage({
  searchParams,
}: PageProps<"/[locale]/device">) {
  const [t, params] = await Promise.all([
    getTranslations("auth.device"),
    searchParams,
  ]);
  const result = one(params.result);
  if (result === "approved" || result === "denied") {
    return (
      <AuthShell heading={t(`${result}Heading`)}>
        <p role="status" className="text-center text-sm text-muted-foreground">
          {t(result)}
        </p>
        <p className="mt-4 text-center">
          <Link href="/account/security#sessions" className={linkClass}>
            {t("sessions")}
          </Link>
        </p>
      </AuthShell>
    );
  }
  const code = one(params.user_code);
  if (!code) return <CodeForm heading={t("heading")} />;
  const { user } = await getMember();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/device?user_code=${encodeURIComponent(code)}`)}`,
    );
  }
  const request = await readDeviceRequest(code);
  // Unknown, expired, already answered, or claimed by another account: nothing to approve here.
  if (request?.status !== "pending" || !request.clientId) {
    return <CodeForm heading={t("invalidHeading")} notice={t("invalid")} />;
  }
  return (
    <AuthShell heading={t("requestHeading")}>
      <div className="space-y-4 text-sm">
        {one(params.failed) && (
          <p role="alert" className="text-center text-destructive">
            {t("failed")}
          </p>
        )}
        <p className="text-center">
          {t.rich("request", {
            client: () => (
              <code className="font-mono font-semibold">
                {request.clientId}
              </code>
            ),
          })}
        </p>
        <div className="space-y-2 text-center">
          <p className="text-muted-foreground">{t("codeIntro")}</p>
          <p className="font-mono text-3xl font-bold tracking-widest">
            {shown(code)}
          </p>
        </div>
        <div className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-destructive"
          />
          <p className="min-w-0 font-medium text-pretty">{t("warning")}</p>
        </div>
        <p className="text-muted-foreground">{t("powers")}</p>
        <div className="grid grid-cols-2 gap-3">
          <form action={decideDevice}>
            <input type="hidden" name="user_code" value={code} />
            <input type="hidden" name="choice" value="deny" />
            <PendingButton variant="outline" className="h-10 w-full">
              {t("deny")}
            </PendingButton>
          </form>
          <form action={decideDevice}>
            <input type="hidden" name="user_code" value={code} />
            <input type="hidden" name="choice" value="approve" />
            <PendingButton className="h-10 w-full">
              {t("approve")}
            </PendingButton>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}

// The code typed by hand, sent to this page as `user_code`: a plain GET form.
async function CodeForm({
  heading,
  notice,
}: {
  heading: string;
  notice?: string;
}) {
  const t = await getTranslations("auth.device");
  return (
    <AuthShell heading={heading}>
      <form method="get" action="/device" className="space-y-4">
        {notice ? (
          <p role="alert" className="text-center text-sm text-muted-foreground">
            {notice}
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {t("enter")}
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="user_code">{t("codeLabel")}</Label>
          <Input
            id="user_code"
            name="user_code"
            required
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={32}
            className="h-10 font-mono tracking-widest uppercase"
          />
        </div>
        <PendingButton className="h-10 w-full">{t("continue")}</PendingButton>
      </form>
    </AuthShell>
  );
}
