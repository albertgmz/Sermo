import { creditRulesBackfillStatus } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Field } from "@/components/staff/field";
import { FormRows } from "@/components/staff/form-rows";
import { RefreshWhile } from "@/components/staff/refresh-while";
import { linkClass, Section } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatCredits } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { payPastActivity, previewPastActivity } from "./actions";

type Status = z.output<typeof creditRulesBackfillStatus.output>;
type Run = NonNullable<Status["latest"]>;

// The defaults of the form: from 2020-01-01 to today (UTC), widened to the dates already paid,
// which a new run must include.
function defaults(paid: Status["paidRange"]) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: paid && paid.from < "2020-01-01" ? paid.from : "2020-01-01",
    until: paid && paid.until > today ? paid.until : today,
  };
}

// One figure of a finished run: its name and its value.
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="min-w-0">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

// The figures of a finished run: members and credits, what one member is paid, by event, and the
// members paid most.
async function Summary({ summary }: { summary: NonNullable<Run["summary"]> }) {
  const [t, triggers, format, locale] = await Promise.all([
    getTranslations("adminEconomy.rules.past"),
    getTranslations("adminEconomy.rules.triggers"),
    getFormatter(),
    getLocale(),
  ]);
  const credits = (value: number) => formatCredits(value, locale);
  return (
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <dl className="space-y-1">
        <Figure label={t("members")} value={format.number(summary.members)} />
        <Figure label={t("credits")} value={credits(summary.credits)} />
        <Figure
          label={t("heldAtCap")}
          value={format.number(summary.heldAtCap)}
        />
        <Figure label={t("p50")} value={credits(summary.paid.p50)} />
        <Figure label={t("p90")} value={credits(summary.paid.p90)} />
        <Figure label={t("p99")} value={credits(summary.paid.p99)} />
        <Figure label={t("max")} value={credits(summary.paid.max)} />
      </dl>
      <div className="space-y-1">
        <h3 className="text-xs font-semibold">{t("byTrigger")}</h3>
        <dl className="space-y-1">
          {summary.byTrigger.map((row) => (
            <Figure
              key={row.trigger}
              label={triggers(row.trigger)}
              value={credits(row.credits)}
            />
          ))}
        </dl>
      </div>
      {summary.top.length > 0 && (
        <div className="space-y-1 md:col-span-2">
          <h3 className="text-xs font-semibold">{t("top")}</h3>
          <ol className="divide-y">
            {summary.top.map((row) => (
              <li
                key={row.user.id}
                className="flex flex-wrap items-center justify-between gap-x-3"
              >
                <Link
                  href={`/members/${row.user.id}`}
                  className={`${linkClass} min-w-0 font-medium [overflow-wrap:anywhere]`}
                >
                  {row.user.username}
                </Link>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("topLine", {
                    total: credits(row.total),
                    paid: credits(row.paid),
                  })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// "Pay past activity": the form that starts a preview, then where the latest run stands, its
// figures, and the button that pays a finished preview. While a run is under way the page
// refreshes itself and the form waits.
export async function PastActivity() {
  const [t, format, locale, status] = await Promise.all([
    getTranslations("adminEconomy.rules.past"),
    getFormatter(),
    getLocale(),
    read(creditRulesBackfillStatus, {}),
  ]);
  const run = status.latest;
  const running = run?.state === "running";
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  const figures = run && {
    percent: format.number(run.progress, { style: "percent" }),
    from: day(run.from),
    until: day(run.until),
    cap: formatCredits(run.cap, locale),
    members: format.number(run.summary?.members ?? 0),
    credits: formatCredits(run.summary?.credits ?? 0, locale),
    error: run.error ?? "",
  };
  const previewing = run?.mode === "preview";
  const line =
    !run || !figures
      ? t("idle")
      : run.state === "running"
        ? t(previewing ? "progressPreview" : "progressApply", figures)
        : run.state === "failed"
          ? t(previewing ? "failedPreview" : "failedApply", figures)
          : t(previewing ? "donePreview" : "doneApply", figures);
  const start = defaults(status.paidRange);
  return (
    <>
      <FormRows
        action={previewPastActivity}
        heading={t("heading")}
        description={t("help")}
        submit={t("preview")}
        disabled={running}
      >
        <Field
          name="from"
          label={t("from")}
          htmlFor="past-from"
          help={t("fromHelp")}
        >
          <Input
            id="past-from"
            name="from"
            type="date"
            required
            defaultValue={start.from}
            aria-describedby="past-from-help past-from-error"
          />
        </Field>
        <Field
          name="until"
          label={t("until")}
          htmlFor="past-until"
          help={t("untilHelp")}
        >
          <Input
            id="past-until"
            name="until"
            type="date"
            required
            defaultValue={start.until}
            aria-describedby="past-until-help past-until-error"
          />
        </Field>
        <Field
          name="cap"
          label={t("cap")}
          htmlFor="past-cap"
          help={t("capHelp")}
        >
          <Input
            id="past-cap"
            name="cap"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            defaultValue={20000}
            aria-describedby="past-cap-help past-cap-error"
          />
        </Field>
      </FormRows>
      <Section heading={t("latest")}>
        <div className="space-y-4 p-4">
          {running && (
            <Progress value={run.progress * 100} aria-label={t("aria")} />
          )}
          <p role="status" className="text-sm text-pretty">
            {line}
          </p>
          {run && (
            <p className="text-xs text-muted-foreground">
              {t("started", {
                when: format.dateTime(new Date(run.startedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
          )}
          {status.paidRange && (
            <p className="text-xs text-muted-foreground">
              {t("paidRange", {
                from: day(status.paidRange.from),
                until: day(status.paidRange.until),
              })}
            </p>
          )}
          {run?.summary && <Summary summary={run.summary} />}
          {previewing && run.state === "done" && figures && (
            <ConfirmStep
              action={payPastActivity}
              fields={{ previewId: run.id }}
              summary={t("apply")}
              submit={t("applyNow")}
              pendingLabel={t("starting")}
              warning={t("applyWarning", figures)}
              danger={false}
            />
          )}
        </div>
        <RefreshWhile active={running} />
      </Section>
    </>
  );
}
