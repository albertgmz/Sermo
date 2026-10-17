import type { creditRulesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import { RuleFields, type TriggerChoice } from "./rule-fields";

export type Rule = z.output<typeof creditRulesList.output>["items"][number];
export type NodeChoice = { id: number; title: string; depth: number };

// The help and error lines of a `Field`, by its control's id.
const describedBy = (id: string) => `${id}-help ${id}-error`;

// The fields of a rule, for a new one (no `rule`) or a change, inside the page's `EditForm`. The
// trigger of a rule is fixed once it exists.
export async function RuleFormFields({
  rule,
  triggers,
  nodes,
}: {
  rule?: Rule;
  triggers: TriggerChoice[];
  nodes: NodeChoice[];
}) {
  const t = await getTranslations("adminEconomy.rules.form");
  const key = `rule-${rule?.id ?? "new"}`;
  return (
    <>
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <FieldGroup legend={t("basics")} description={t("basicsHelp")}>
        <Field name="title" label={t("title")} htmlFor={`${key}-title`}>
          <Input
            id={`${key}-title`}
            name="title"
            required
            defaultValue={rule?.title}
            aria-describedby={`${key}-title-error`}
          />
        </Field>
        <RuleFields
          idPrefix={key}
          fixedTrigger={rule?.trigger}
          triggerChoices={triggers}
          nodes={nodes}
          chosen={rule?.nodeIds ?? []}
        />
        <Field
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
            aria-describedby={describedBy(`${key}-amount`)}
            className="w-32"
          />
        </Field>
        <Field name="limit" label={t("limit")} help={t("limitHelp")}>
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
        </Field>
        <Field name="isActive" label={t("active")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={rule ? rule.isActive : true}
              className="size-5"
            />
            {t("activeHelp")}
          </label>
        </Field>
      </FieldGroup>
    </>
  );
}
