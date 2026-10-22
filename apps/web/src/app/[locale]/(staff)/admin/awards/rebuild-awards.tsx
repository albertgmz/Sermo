import { awardsRebuildStatus } from "@sermo/core/contracts";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { RefreshWhile } from "@/components/staff/refresh-while";
import { Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Progress } from "@/components/ui/progress";
import { formatCredits } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { previewRebuild, rebuildLevelsAndAwards, stopRebuild } from "./actions";

// "Rebuild levels and awards": where the latest run stands, what the last one changed, and the
// button that starts it (behind a confirmation that names the effect and asks for the
// administrator's password) or resumes one that stopped. While a run is under way the page
// refreshes itself.
export async function RebuildAwards() {
  const [t, format, locale, run] = await Promise.all([
    getTranslations("adminEconomy.awards.rebuild"),
    getFormatter(),
    getLocale(),
    read(awardsRebuildStatus, {}),
  ]);
  const running = run.state === "running";
  const figures = {
    percent: format.number(run.progress, { style: "percent" }),
    members: format.number(run.members),
    xpCorrected: format.number(run.xpCorrected),
    up: format.number(run.levelsUp),
    down: format.number(run.levelsDown),
    granted: format.number(run.granted),
    takenBack: format.number(run.takenBack),
    paid: formatCredits(run.creditsPaid, locale),
    removed: formatCredits(run.creditsRemoved, locale),
    negative: format.number(run.newlyNegative),
    error: run.error ?? "",
  };
  const status = {
    idle: t("idle"),
    running: t(run.dryRun ? "progressPreview" : "progress", figures),
    failed: t(run.dryRun ? "failedPreview" : "failed", figures),
    stopped: t(run.dryRun ? "stoppedPreview" : "stopped", figures),
    done: t(run.dryRun ? "donePreview" : "done", figures),
  }[run.state];
  // A stopped or failed real run is resumed by the same button; a preview has its own.
  const stoppedPreview =
    (run.state === "failed" || run.state === "stopped") && run.dryRun;
  const resumable =
    (run.state === "failed" || run.state === "stopped") && !run.dryRun;
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
        <p role="status" className="text-sm text-pretty">
          {status}
        </p>
        {run.startedAt && (
          <p className="text-xs text-muted-foreground">
            {t("started", { when: when(run.startedAt) })}
            {run.finishedAt &&
              ` ${t("finished", { when: when(run.finishedAt) })}`}
          </p>
        )}
        {run.awards.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-xs font-semibold">{t("byAward")}</h3>
            <ul className="space-y-0.5 text-sm">
              {run.awards.map((award) => (
                <li key={award.awardId} className="flex justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {award.name}
                  </span>
                  <span className="tabular-nums">
                    {format.number(award.granted)} /{" "}
                    {format.number(award.takenBack)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {running ? (
          <RunNow
            action={stopRebuild}
            namespace="adminEconomy.awards"
            labels={{ run: t("stop"), running: t("starting") }}
          />
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            <RunNow
              action={previewRebuild}
              namespace="adminEconomy.awards"
              labels={{
                run: stoppedPreview ? t("previewResume") : t("preview"),
                running: t("starting"),
              }}
            />
            <ConfirmStep
              action={rebuildLevelsAndAwards}
              summary={resumable ? t("resume") : t("rebuild")}
              submit={resumable ? t("resume") : t("rebuildNow")}
              pendingLabel={t("starting")}
              warning={t("warning")}
              password
            />
          </div>
        )}
      </div>
      <RefreshWhile active={running} />
    </Section>
  );
}
