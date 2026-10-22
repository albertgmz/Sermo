import { broadcastsStatus } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { RefreshWhile } from "@/components/staff/refresh-while";
import { Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Progress } from "@/components/ui/progress";
import { read } from "@/lib/sermo/client";
import { resumeCount, resumeSend, stopRun } from "./actions";

// "Latest run": where the latest send or count stands and what it reached, with the button that
// stops the run under way or resumes one that stopped (a send behind the administrator's password).
// While a run is under way the page refreshes itself.
export async function BroadcastStatus() {
  const [t, format, run] = await Promise.all([
    getTranslations("adminCommunication.broadcasts.run"),
    getFormatter(),
    read(broadcastsStatus, {}),
  ]);
  const running = run.state === "running";
  const figures = {
    summary: run.summary,
    percent: format.number(run.progress, { style: "percent" }),
    members: format.number(run.members),
    matched: format.number(run.matched),
    sent: format.number(run.sent),
    skipped: format.number(run.skipped),
    error: run.error ?? "",
  };
  const status = {
    idle: t("idle"),
    running: t(run.dryRun ? "progressCount" : "progress", figures),
    failed: t(run.dryRun ? "failedCount" : "failed", figures),
    stopped: t(run.dryRun ? "stoppedCount" : "stopped", figures),
    done: t(run.dryRun ? "doneCount" : "done", figures),
  }[run.state];
  const resumable = run.state === "failed" || run.state === "stopped";
  const when = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return (
    <Section heading={t("heading")} description={t("help")}>
      <div className="space-y-4 p-4">
        {running && (
          <Progress value={run.progress * 100} aria-label={t("aria")} />
        )}
        <p
          role="status"
          className="text-sm text-pretty [overflow-wrap:anywhere]"
        >
          {status}
        </p>
        {run.startedAt && (
          <p className="text-xs text-muted-foreground">
            {t("started", { when: when(run.startedAt) })}
            {run.finishedAt &&
              ` ${t("finished", { when: when(run.finishedAt) })}`}
          </p>
        )}
        {running && (
          <RunNow
            action={stopRun}
            namespace="adminCommunication.broadcasts.run"
            labels={{ run: t("stop"), running: t("starting") }}
          />
        )}
        {resumable && run.dryRun && (
          <RunNow
            action={resumeCount}
            namespace="adminCommunication.broadcasts.run"
            labels={{ run: t("resumeCount"), running: t("starting") }}
          />
        )}
        {resumable && !run.dryRun && (
          <ConfirmStep
            action={resumeSend}
            summary={t("resume")}
            submit={t("resumeNow")}
            pendingLabel={t("starting")}
            warning={t("resumeWarning")}
            danger={false}
            password
          />
        )}
      </div>
      <RefreshWhile active={running} />
    </Section>
  );
}
