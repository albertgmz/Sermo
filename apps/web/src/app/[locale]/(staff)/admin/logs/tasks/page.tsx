import { adminJobs } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { StatTile } from "@/components/forum/stat";
import { Section } from "@/components/staff/rows";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { ContentSkeleton } from "../../../moderation/skeletons";
import { staffTrail } from "../../../trail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTools.tasks");
  return { title: t("metaTitle") };
}

export default function TasksPage() {
  const t = useTranslations("adminTools.tasks");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/logs/tasks")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ContentSkeleton />}
    >
      <Tasks />
    </ScreenFrame>
  );
}

// The state of the background work: counts, the age of the oldest waiting job and the recent
// failures with their type and error. The read has no cursor.
async function Tasks() {
  const [t, format, jobs] = await Promise.all([
    getTranslations("adminTools.tasks"),
    getFormatter(),
    read(adminJobs, {}),
  ]);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t("pending")} value={format.number(jobs.pending)} />
        <StatTile label={t("running")} value={format.number(jobs.running)} />
        <StatTile label={t("failed")} value={format.number(jobs.failed)} />
      </div>
      <p className="text-sm">
        <span className="font-medium">{t("oldest")}:</span>{" "}
        {jobs.oldestPendingAt ? (
          <RelativeTime date={jobs.oldestPendingAt} />
        ) : (
          t("nonePending")
        )}
      </p>
      <Section
        heading={t("failuresHeading")}
        description={t("failuresDescription")}
      >
        {jobs.failures.length > 0 ? (
          <ul className="divide-y">
            {jobs.failures.map((job) => (
              <li key={job.id} className="space-y-1 p-4 text-sm">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold [overflow-wrap:anywhere]">
                    {job.type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("job", { id: job.id })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("failedAt")} <RelativeTime date={job.failedAt} />
                  </span>
                </p>
                <p className="font-mono text-xs text-destructive [overflow-wrap:anywhere]">
                  {job.error}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {t("failuresEmpty")}
          </p>
        )}
      </Section>
    </>
  );
}
