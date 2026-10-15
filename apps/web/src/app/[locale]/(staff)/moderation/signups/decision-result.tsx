import { getTranslations } from "next-intl/server";
import { MemberOutcomeList } from "@/components/staff/member-outcomes";
import { type Params, readResult } from "./result";

// What the last decision did, from the address it redirected to: the counts, and for each account
// that was skipped or refused the backend's reason. Shown above the queue; an address without a
// well-formed result shows nothing.
export async function DecisionResult({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const result = readResult(await searchParams);
  if (!result) return null;
  const t = await getTranslations("moderation.signups.result");
  const { decision, done, skipped, failed, lines } = result;
  const hidden = skipped + failed - lines.length;
  return (
    <div className="space-y-2">
      <output
        className={`block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium ${done === 0 ? "text-muted-foreground" : "text-success"}`}
      >
        {t(decision, { done, skipped, failed })}
      </output>
      {lines.length > 0 && <MemberOutcomeList items={lines} />}
      {hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("more", { count: hidden })}
        </p>
      )}
    </div>
  );
}
