import { creditsLedger } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Field } from "@/components/staff/edit-form";
import { FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../registry";
import { memberNames } from "../logs/links";
import { ifAllowed } from "../users/data";
import { adjustCredits } from "./actions";
import { MemberChoice } from "./member-choice";
import { adjustmentRefusal } from "./review";
import { one } from "./shared";

type Params = Awaited<PageProps<"/[locale]/admin/credits">["searchParams"]>;

// The adjustment in three steps held in the address: the member (`userId`), the amount and
// reason as typed (a GET form, which is the review), and the confirmation, a form that posts
// them. The balance and the recent ledger need credits.viewAny; without it the screen still
// adjusts and says it cannot show them.
export async function AdjustScreen({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/credits">["searchParams"];
}) {
  const params: Params = await searchParams;
  const [t, kinds, format, viewer] = await Promise.all([
    getTranslations("adminEconomy.adjust"),
    getTranslations("credits.history.types"),
    getFormatter(),
    getViewer(),
  ]);
  const userId = parseId(one(params.userId));
  const newBalance = /^-?\d{1,15}$/.test(one(params.balance))
    ? Number(one(params.balance))
    : null;
  const notices = {
    adjusted:
      newBalance === null
        ? t("notices.adjusted")
        : t("notices.adjustedBalance", { balance: format.number(newBalance) }),
  };
  const picker = (
    <MemberChoice
      path="/admin/credits"
      userId={userId}
      params={params}
      heading={t("member")}
    />
  );
  if (userId === null) {
    return (
      <>
        <Notice searchParams={searchParams} notices={notices} />
        {picker}
      </>
    );
  }

  const ledger = await ifAllowed(() =>
    call(creditsLedger, { userId, limit: 10 }),
  );
  const name = await memberNames(
    [
      userId,
      ...(ledger?.items.flatMap((row) => (row.actor ? [row.actor.id] : [])) ??
        []),
    ],
    ledger?.items.flatMap((row) => (row.actor ? [row.actor] : [])),
  );
  const balance = ledger?.balance ?? null;

  const typedAmount = one(params.amount).trim();
  const reason = one(params.reason).trim();
  const amount = /^-?\d{1,15}$/.test(typedAmount) ? Number(typedAmount) : null;
  const reviewing = typedAmount !== "" || reason !== "";
  const full = hrefFor(viewer, "toolsCreditLedger");
  const base = `/admin/credits?userId=${userId}`;
  const refused =
    reviewing && amount !== null && reason !== ""
      ? adjustmentRefusal(userId, amount, reason)
      : null;
  const problem =
    reviewing && amount === null
      ? t("amountProblem")
      : reviewing && reason === ""
        ? t("reasonProblem")
        : refused;
  const confirming = reviewing && !problem && amount !== null;

  return (
    <>
      <Notice searchParams={searchParams} notices={notices} />
      {picker}
      <Section
        heading={t("formHeading", { name: name(userId) })}
        description={
          balance === null
            ? t("balanceUnknown")
            : t("balanceNow", { balance: format.number(balance) })
        }
      >
        <form method="get" className="divide-y">
          <input type="hidden" name="userId" value={userId} />
          <Field
            name="amount"
            label={t("amount")}
            htmlFor="adjust-amount"
            help={t("amountHelp")}
          >
            <Input
              id="adjust-amount"
              name="amount"
              type="number"
              inputMode="numeric"
              required
              defaultValue={typedAmount}
            />
          </Field>
          <Field
            name="reason"
            label={t("reason")}
            htmlFor="adjust-reason"
            help={t("reasonHelp")}
          >
            <Input
              id="adjust-reason"
              name="reason"
              required
              defaultValue={reason}
            />
          </Field>
          {problem && (
            <p
              role="alert"
              className="px-4 py-2.5 text-xs font-medium text-destructive"
            >
              {problem}
            </p>
          )}
          <div className="p-4">
            <Button type="submit" className="min-h-10 px-4">
              {t("review")}
            </Button>
          </div>
        </form>
      </Section>
      {confirming && amount !== null && (
        <FormRows
          action={adjustCredits}
          heading={t("confirmHeading")}
          description={t("confirmDescription")}
          submit={t("confirm")}
        >
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="amount" value={amount} />
          <input type="hidden" name="reason" value={reason} />
          <Field name="amount" label={t("summary")}>
            <p className="text-sm [overflow-wrap:anywhere]">
              {t("summaryLine", {
                name: name(userId),
                amount: format.number(amount, { signDisplay: "always" }),
                reason,
              })}
            </p>
            {balance !== null ? (
              <p className="text-sm font-medium">
                {t("beforeAfter", {
                  before: format.number(balance),
                  after: format.number(balance + amount),
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("balanceUnknown")}
              </p>
            )}
            <Link
              href={base}
              className="inline-flex min-h-10 items-center text-sm text-primary-ink underline-offset-4 hover:underline"
            >
              {t("change")}
            </Link>
          </Field>
        </FormRows>
      )}
      {ledger && (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <h2 className="text-sm font-semibold">{t("ledgerHeading")}</h2>
            {full && (
              <Link
                href={`${full}?userId=${userId}`}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "min-h-10 px-4",
                )}
              >
                {t("fullLedger")}
              </Link>
            )}
          </div>
          {ledger.items.length > 0 ? (
            <ul aria-label={t("ledgerHeading")} className="divide-y">
              {ledger.items.map((row) => (
                <li
                  key={row.id}
                  className="grid gap-1 p-4 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:gap-4"
                >
                  <p
                    className={`font-semibold tabular-nums ${row.amount < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {format.number(row.amount, { signDisplay: "always" })}
                  </p>
                  <div className="min-w-0 space-y-0.5 [overflow-wrap:anywhere]">
                    <p>
                      <Badge variant="secondary">{kinds(row.type)}</Badge>{" "}
                      {row.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.actor &&
                        `${t("by", { name: name(row.actor.id) })} · `}
                      {t("after", { balance: format.number(row.balanceAfter) })}
                    </p>
                  </div>
                  <time
                    dateTime={row.createdAt}
                    className="text-xs text-muted-foreground"
                  >
                    {format.dateTime(new Date(row.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("noLedger")}</p>
          )}
        </section>
      )}
    </>
  );
}
