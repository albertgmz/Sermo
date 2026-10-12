import type { creditRulesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { saveRule } from "./actions";
import { RuleFields } from "./rule-fields";

export type Rule = z.output<typeof creditRulesList.output>["items"][number];
export type NodeChoice = { id: number; title: string; depth: number };

// The form of a rule, for a new one (no `rule`) or a change. The trigger of a rule is fixed.
export async function RuleForm({
  rule,
  nodes,
}: {
  rule?: Rule;
  nodes: NodeChoice[];
}) {
  const t = await getTranslations("adminEconomy.rules.form");
  const key = `rule-${rule?.id ?? "new"}`;
  return (
    <FormRows
      action={saveRule}
      id={rule ? undefined : "new"}
      heading={rule ? t("headingEdit") : t("headingNew")}
      description={rule ? undefined : t("descriptionNew")}
      submit={rule ? undefined : t("create")}
    >
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <FieldRow name="title" label={t("title")} htmlFor={`${key}-title`}>
        <Input
          id={`${key}-title`}
          name="title"
          required
          maxLength={100}
          defaultValue={rule?.title}
        />
      </FieldRow>
      <RuleFields
        idPrefix={key}
        fixedTrigger={rule?.trigger}
        nodes={nodes}
        chosen={rule?.nodeIds ?? []}
      />
      <FieldRow
        name="amount"
        label={t("amount")}
        htmlFor={`${key}-amount`}
        help={t("amountHelp")}
      >
        <Input
          id={`${key}-amount`}
          name="amount"
          type="number"
          inputMode="numeric"
          required
          defaultValue={rule?.amount}
        />
      </FieldRow>
      <FieldRow name="limit" label={t("limit")} help={t("limitHelp")}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input
            id={`${key}-limit-count`}
            name="limitCount"
            type="number"
            inputMode="numeric"
            min={1}
            aria-label={t("limitCount")}
            defaultValue={rule?.limit?.count}
            className="w-28"
          />
          <span>{t("limitPer")}</span>
          <Input
            id={`${key}-limit-hours`}
            name="limitHours"
            type="number"
            inputMode="numeric"
            min={1}
            aria-label={t("limitHours")}
            defaultValue={rule?.limit?.windowHours}
            className="w-28"
          />
          <span>{t("limitHoursUnit")}</span>
        </div>
      </FieldRow>
      <FieldRow name="isActive" label={t("active")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={rule ? rule.isActive : true}
            className="size-5"
          />
          {t("activeHelp")}
        </label>
      </FieldRow>
    </FormRows>
  );
}
