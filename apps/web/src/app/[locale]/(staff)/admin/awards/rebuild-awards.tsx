import { awardsRebuildStatus } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { RefreshWhile } from "@/components/staff/refresh-while";
import { Section } from "@/components/staff/rows";
import { Progress } from "@/components/ui/progress";
import { read } from "@/lib/sermo/client";
import { rebuildLevelsAndAwards } from "./actions";

// "Rebuild levels and awards": where the latest run stands, what the last one changed, and the
// button that starts it (behind a confirmation that names the effect and asks for the
// administrator's password) or resumes one that stopped. While a run is under way the page
// refreshes itself.
export async function RebuildAwards() {
  const [t, format, run] = await Promise.all([
    getTranslations("adminEconomy.awards.rebuild"),
    getFormatter(),
    read(awardsRebuildStatus, {}),
  ]);
  const running = run.state === "running";
  const figures = {
    percent: format.number(run.progress, { style: "percent" }),
    members: format.number(run.members),
    xpCorrected: format.number(run.xpCorrected),
    levels: format.number(run.levelsChanged),
    granted: format.number(run.granted),
    takenBack: format.number(run.takenBack),
    error: run.error ?? "",
  };
  const status = {
    idle: t("idle"),
    running: t("progress", figures),
    failed: t("failed", figures),
    done: t("done", figures),
  }[run.state];
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
        {!running && (
          <ConfirmStep
            action={rebuildLevelsAndAwards}
            summary={run.state === "failed" ? t("resume") : t("rebuild")}
            submit={run.state === "failed" ? t("resume") : t("rebuildNow")}
            pendingLabel={t("starting")}
            warning={t("warning")}
            password
          />
        )}
      </div>
      <RefreshWhile active={running} />
    </Section>
  );
}
