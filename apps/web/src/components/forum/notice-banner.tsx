import { noticesCurrent } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { HtmlContent } from "@/components/forum/html-content";
import { NoticeDismissButton } from "@/components/forum/notice-dismiss-button";
import { Container } from "@/components/layout/container";
import {
  NOTICES_DISMISSED_COOKIE,
  parseDismissed,
} from "@/lib/notice-dismissals";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// The site notices for this visitor, drawn once under the header. Asked per request, as the
// visitor: what each one is shown to depends on who is asking. A guest's dismissals are in a
// cookie, read first (request data before anything else); a member's are kept by the backend. A
// failed read draws nothing, so a notice never takes the page down.
export async function NoticeBanner() {
  const dismissed = parseDismissed(
    (await cookies()).get(NOTICES_DISMISSED_COOKIE)?.value,
  );
  let items: Awaited<ReturnType<typeof current>>;
  try {
    items = await current();
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return null;
  }
  const shown = items.filter((item) => !dismissed.includes(item.id));
  if (shown.length === 0) return null;
  const t = await getTranslations("layout.noticeBanner");
  return (
    <section aria-label={t("label")} className="border-b bg-muted">
      <Container>
        <ul className="divide-y divide-border">
          {shown.map((item) => (
            <li key={item.id} className="flex items-start gap-2 py-3">
              <div className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
                <p className="text-sm font-semibold">{item.title}</p>
                <HtmlContent className="text-sm">{item.bodyHtml}</HtmlContent>
              </div>
              {item.dismissible && <NoticeDismissButton id={item.id} />}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

async function current() {
  return (await call(noticesCurrent, {})).items;
}
