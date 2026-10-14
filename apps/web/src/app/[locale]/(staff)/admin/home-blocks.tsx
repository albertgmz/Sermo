import {
  adminActivity,
  adminJobs,
  adminStaffOnline,
} from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type * as z from "zod";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { orNothing } from "../or-nothing";
import { canOpen, hrefFor, type ScreenKey, visibleSections } from "../registry";

const LINK =
  "inline-flex min-h-10 items-center text-sm text-primary underline-offset-4 hover:underline";

// The sections the viewer may open, each with the screens it holds. The home section is the
// page itself.
export async function SectionGrid() {
  const [viewer, t] = await Promise.all([
    getViewer(),
    getTranslations("admin.registry"),
  ]);
  const sections = visibleSections(viewer).filter(
    (section) => section.id !== "home",
  );
  const home = await getTranslations("admin.home");
  if (sections.length === 0) {
    return (
      <EmptyState
        title={home("sectionsEmpty")}
        description={home("sectionsEmptyDescription")}
        className="rounded-lg border bg-card"
      />
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{home("sectionsHeading")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <section
            key={section.id}
            className="min-w-0 rounded-lg border bg-card p-4"
          >
            <h3 className="text-sm font-semibold">
              {t(`sections.${section.id}`)}
            </h3>
            <ul className="mt-2">
              {section.screens.map((screen) => (
                <li key={screen.key}>
                  <Link href={screen.path} className={LINK}>
                    {t(`screens.${screen.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

// Where each kind of logged activity is read, when that screen is built and the viewer may open it.
type Kind = z.output<typeof adminActivity.output>["items"][number]["kind"];

const LOG_SCREEN: Record<Kind, ScreenKey> = {
  moderation: "toolsModeratorLog",
  reports: "moderationReports",
  creditAdjustments: "toolsCreditLedger",
  shopPurchases: "toolsShopPurchases",
  promotions: "toolsPromotionLog",
  registrations: "usersList",
};

// What was logged over the last day, week and thirty days, per kind. The backend returns only the
// kinds the viewer may read, and "not found" when there are none: then nothing is shown.
export async function Activity() {
  const [viewer, t, format] = await Promise.all([
    getViewer(),
    getTranslations("admin.homeActivity"),
    getFormatter(),
  ]);
  const activity = await orNothing(() => call(adminActivity, {}));
  if (!activity || activity.items.length === 0) return null;
  return (
    <SectionCard title={t("heading")} description={t("description")}>
      {activity.items.map((item) => {
        const href = hrefFor(viewer, LOG_SCREEN[item.kind]);
        return (
          <div key={item.kind} className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="min-w-0 text-sm font-medium">
                {t(`kinds.${item.kind}`)}
              </h3>
              {href && (
                <Link href={href} className={LINK}>
                  {t("open")}
                </Link>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              {(["day", "week", "month"] as const).map((span) => (
                <div key={span} className="flex flex-col">
                  <dd className="order-first text-base font-bold text-foreground tabular-nums">
                    {format.number(item[span])}
                  </dd>
                  <dt>{t(span)}</dt>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </SectionCard>
  );
}

// The staff members seen in the last fifteen minutes.
export async function StaffOnline() {
  const [t, online] = await Promise.all([
    getTranslations("admin.homeStaff"),
    orNothing(() => call(adminStaffOnline, {})),
  ]);
  if (!online) return null;
  const member = await membersFor(online.items.map((item) => item.card));
  return (
    <SectionCard title={t("heading")} description={t("description")}>
      {online.items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        online.items.map((item) => (
          <MemberRow
            key={item.card.id}
            user={member(item.card.id)}
            badgeLimit={1}
          >
            <RelativeTime
              date={item.lastActivityAt}
              className="shrink-0 text-xs text-muted-foreground"
            />
          </MemberRow>
        ))
      )}
    </SectionCard>
  );
}

// The state of the background work, for those who may change the settings.
export async function Jobs() {
  const viewer = await getViewer();
  if (!canOpen(viewer, { access: ["admin.settings"] })) return null;
  const [t, format, jobs] = await Promise.all([
    getTranslations("admin.homeJobs"),
    getFormatter(),
    orNothing(() => call(adminJobs, {})),
  ]);
  if (!jobs) return null;
  const counts = [
    ["pending", jobs.pending],
    ["running", jobs.running],
    ["failed", jobs.failed],
  ] as const;
  const oldest = jobs.oldestPendingAt;
  return (
    <SectionCard title={t("heading")} description={t("description")}>
      <dl className="grid grid-cols-3 gap-2 px-4 py-3">
        {counts.map(([name, count]) => (
          <div key={name} className="flex flex-col">
            <dd className="order-first text-xl font-bold tabular-nums">
              {format.number(count)}
            </dd>
            <dt className="text-xs text-muted-foreground">{t(name)}</dt>
          </div>
        ))}
      </dl>
      {oldest && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {t.rich("oldest", {
            when: () => (
              <RelativeTime date={oldest} className="text-foreground" />
            ),
          })}
        </p>
      )}
      <div className="px-4 py-3">
        <h3 className="text-xs font-semibold">{t("failuresHeading")}</h3>
        {jobs.failures.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("noFailures")}
          </p>
        ) : (
          <ul className="mt-2 divide-y">
            {jobs.failures.map((failure) => (
              <li key={failure.id} className="space-y-0.5 py-2">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">
                  {failure.type}
                </p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {failure.error}
                </p>
                <RelativeTime
                  date={failure.failedAt}
                  className="block text-xs text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
