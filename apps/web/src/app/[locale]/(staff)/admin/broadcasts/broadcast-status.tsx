import { broadcastsStatus } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { RefreshWhile } from "@/components/staff/refresh-while";
import { Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Progress } from "@/components/ui/progress";
import { read } from "@/lib/sermo/client";
import {
  discardCount,
  discardSend,
  resumeCount,
  resumeSend,
  sendCounted,
  stopRun,
} from "./actions";
import type { BroadcastKind } from "./state";

// "Latest run": where the latest send or count stands and what it reached, with the button that
// stops the run under way or resumes one that stopped (a send behind the administrator's password).
// Each button names the run it was drawn for, and the backend refuses it on any other; a stopped
// run is resumed or discarded only from the page of its kind. While a run is under way the page
// refreshes itself.
export async function BroadcastStatus({ kind }: { kind: BroadcastKind }) {
  const [t, format, run] = await Promise.all([
    getTranslations("adminCommunication.broadcasts.run"),
    getFormatter(),
    read(broadcastsStatus, {}),
  ]);
  const when = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const running = run.state === "running";
  const figures = {
    summary: run.summary,
    kind: run.kind ?? "message",
    percent: format.number(run.progress, { style: "percent" }),
    members: format.number(run.members),
    matched: format.number(run.matched),
    reachable: format.number(run.reachable),
    when: run.finishedAt ? when(run.finishedAt) : "",
    started: run.startedAt ? when(run.startedAt) : "",
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
    discarded: t("discardedRun", figures),
  }[run.state];
  const stopped = run.state === "failed" || run.state === "stopped";
  const resumable = stopped && run.kind === kind;
  // What the buttons act on: the run this panel shows, and no other.
  const seen = { runAt: run.startedAt ?? "", kind };
  // A finished count is what a send is made of.
  const counted = run.state === "done" && run.dryRun;
  const sendable = counted && run.kind === kind;
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
        {run.startedBy && (
          <p className="text-xs text-muted-foreground">
            {t("startedBy", { name: run.startedBy.username })}
            {run.sender && ` ${t("sentAs", { name: run.sender.username })}`}
          </p>
        )}
        {counted && !sendable && (
          <p role="status" className="text-sm font-medium">
            {t("otherKind", figures)}
          </p>
        )}
        {stopped && !resumable && (
          <p role="status" className="text-sm font-medium">
            {t("otherKindStopped", figures)}
          </p>
        )}
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
            fields={{ runAt: seen.runAt }}
          />
        )}
        {resumable && run.dryRun && (
          <RunNow
            action={resumeCount}
            namespace="adminCommunication.broadcasts.run"
            labels={{ run: t("resumeCount"), running: t("starting") }}
            fields={seen}
          />
        )}
        {resumable && run.dryRun && (
          <RunNow
            action={discardCount}
            namespace="adminCommunication.broadcasts.run"
            labels={{ run: t("discardCount"), running: t("starting") }}
            fields={seen}
          />
        )}
        {resumable && !run.dryRun && (
          <div className="flex flex-wrap items-start gap-3">
            <ConfirmStep
              action={resumeSend}
              summary={t("resume")}
              submit={t("resumeNow")}
              pendingLabel={t("starting")}
              fields={seen}
              warning={t("resumeWarning", figures)}
              danger={false}
              password
            />
            <ConfirmStep
              action={discardSend}
              summary={t("discard")}
              submit={t("discardNow")}
              pendingLabel={t("starting")}
              fields={seen}
              warning={t("discardWarning", figures)}
              password
            />
          </div>
        )}
        {sendable && (
          <ConfirmStep
            action={sendCounted}
            summary={t("sendCounted")}
            submit={t("sendNow")}
            pendingLabel={t("starting")}
            fields={{ countedAt: run.startedAt ?? "" }}
            warning={t("sendWarning", figures)}
            password
          />
        )}
      </div>
      <RefreshWhile active={running} />
    </Section>
  );
}
