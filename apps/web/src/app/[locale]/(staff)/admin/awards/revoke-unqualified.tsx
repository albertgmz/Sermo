import { awardsRevokeStatus } from "@sermo/core/contracts";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { RefreshWhile } from "@/components/staff/refresh-while";
import { Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Progress } from "@/components/ui/progress";
import { formatCredits } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { countUnqualified, revokeUnqualified } from "./actions";

// "Take back from those who no longer qualify": where the latest run stands, what it counted or
// took back by award, and the buttons that go on from there. The count comes first; taking back
// is offered only after a count that found something (or to resume one that stopped). While a run
// is under way the page refreshes itself.
export async function RevokeUnqualified() {
  const [t, format, locale, run] = await Promise.all([
    getTranslations("adminEconomy.awards.revoke"),
    getFormatter(),
    getLocale(),
    read(awardsRevokeStatus, {}),
  ]);
  const running = run.state === "running";
  const counting = run.mode === "count";
  const figures = {
    percent: format.number(run.progress, { style: "percent" }),
    members: format.number(run.members),
    affected: format.number(run.affectedMembers),
    grants: format.number(run.grants),
    xp: format.number(run.xp),
    credits: formatCredits(run.credits, locale),
    error: run.error ?? "",
  };
  const status =
    run.state === "idle"
      ? t("idle")
      : run.state === "running"
        ? t(counting ? "progressCount" : "progressRevoke", figures)
        : run.state === "failed"
          ? t(counting ? "failedCount" : "failedRevoke", figures)
          : counting
            ? t(run.grants > 0 ? "doneCount" : "doneNone", figures)
            : t("doneRevoke", figures);
  const countLabel =
    run.state === "failed" && counting
      ? t("resumeCount")
      : t(run.state === "idle" ? "count" : "recount");
  const offerRevoke =
    (run.state === "done" && counting && run.grants > 0) ||
    (run.state === "failed" && !counting);
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
            {t("started", {
              when: format.dateTime(new Date(run.startedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
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
                    {format.number(award.grants)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!running && (
          <div className="flex flex-wrap items-start gap-3">
            <RunNow
              action={countUnqualified}
              namespace="adminEconomy.awards"
              labels={{ run: countLabel, running: t("starting") }}
            />
            {offerRevoke && (
              <ConfirmStep
                action={revokeUnqualified}
                summary={
                  run.state === "failed" ? t("resumeRevoke") : t("revoke")
                }
                submit={
                  run.state === "failed" ? t("resumeRevoke") : t("revokeNow")
                }
                pendingLabel={t("starting")}
                warning={t("revokeWarning", figures)}
              />
            )}
          </div>
        )}
      </div>
      <RefreshWhile active={running} />
    </Section>
  );
}
