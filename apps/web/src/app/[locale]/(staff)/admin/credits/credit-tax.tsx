import { creditsTaxStatus } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type * as z from "zod";
import { RefreshWhile } from "@/components/staff/refresh-while";
import { linkClass, Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Progress } from "@/components/ui/progress";
import { formatCredits } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { previewTax } from "./actions";

type Run = NonNullable<z.output<typeof creditsTaxStatus.output>["preview"]>;

// "Monthly credit tax": whether it is on and when it charges next, the latest preview of the next
// charge (its figures and the largest charges), the latest charge, and the button that starts a
// preview. While a preview is under way the page refreshes itself.
export async function CreditTax() {
  const [t, format, locale, status] = await Promise.all([
    getTranslations("adminEconomy.tax"),
    getFormatter(),
    getLocale(),
    read(creditsTaxStatus, {}),
  ]);
  const credits = (value: number) => formatCredits(value, locale);
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  const figures = (run: Run) => ({
    day: day(run.chargeOn),
    percent: format.number(run.progress, { style: "percent" }),
    members: format.number(run.members),
    credits: credits(run.credits),
    fee: credits(run.fee),
    minimum: credits(run.minimum),
    step: format.number(run.step),
  });
  const { preview, lastCharge } = status;
  const running = preview?.state === "running";
  const line = !preview
    ? t("idle")
    : preview.state === "running"
      ? t("progress", figures(preview))
      : preview.state === "done"
        ? t("done", figures(preview))
        : t("failed", figures(preview));
  return (
    <Section heading={t("heading")} description={t("help")}>
      <div className="space-y-4 p-4">
        <p className="text-sm text-pretty">
          {status.enabled && status.nextChargeOn
            ? t("on", { day: day(status.nextChargeOn) })
            : t("off")}{" "}
          <Link
            href="/admin/settings/levels?setting=creditTaxEnabled"
            className={linkClass}
          >
            {t("settings")}
          </Link>
        </p>
        {lastCharge && (
          <p className="text-sm text-pretty">
            {t("lastCharge", {
              ...figures(lastCharge),
              state: lastCharge.state,
            })}
          </p>
        )}
        {running && (
          <Progress value={preview.progress * 100} aria-label={t("aria")} />
        )}
        <p role="status" className="text-sm text-pretty">
          {line}
        </p>
        {preview && (
          <p className="text-xs text-muted-foreground">
            {t("started", {
              when: format.dateTime(new Date(preview.startedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        )}
        {preview?.state === "done" && preview.top.length > 0 && (
          <div className="space-y-1 text-sm">
            <h3 className="text-xs font-semibold">{t("top")}</h3>
            <ol className="divide-y">
              {preview.top.map((row) => (
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
                      charge: credits(row.charge),
                      balance: credits(row.balance),
                      months: row.months,
                    })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {!running && (
          <RunNow action={previewTax} namespace="adminEconomy.tax" />
        )}
      </div>
      <RefreshWhile active={running} />
    </Section>
  );
}
