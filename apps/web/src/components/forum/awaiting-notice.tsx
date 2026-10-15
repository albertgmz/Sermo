import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { getViewer } from "@/lib/sermo/session";

// The notice for a member whose account waits for staff to approve it: it reads the forum like a
// guest until then and every write is refused. Drawn under the header like the terms prompt;
// `auth.me` says whether the account waits, so it costs no request. A backend that leaves the
// field out says nobody waits.
export async function AwaitingNotice() {
  const awaiting = (await getViewer()).user?.awaitingApproval === true;
  if (!awaiting) return null;
  return <AwaitingStrip />;
}

export async function AwaitingStrip() {
  const t = await getTranslations("layout.awaitingNotice");
  return (
    <section aria-label={t("label")} className="border-b bg-muted">
      <Container>
        <div className="space-y-1 py-3">
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-sm">{t("body")}</p>
        </div>
      </Container>
    </section>
  );
}
