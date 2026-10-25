"use client";

// The trigger, the forum restriction and the source filters of a credit rule's form. They live
// together because the forum list and the filters are shown only for the triggers that accept
// them. A rule that exists keeps its
// trigger, so the control then only shows it.

import type { creditRulesList } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type * as z from "zod";
import { Field } from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";

// The triggers a rule can have, as the backend lists them, and whether a rule on each may be
// restricted to forums or filtered by its source content.
export type TriggerChoice = z.output<
  typeof creditRulesList.output
>["triggers"][number];

type Filters = z.output<
  typeof creditRulesList.output
>["items"][number]["filters"];

export function RuleFields({
  idPrefix,
  fixedTrigger,
  triggerChoices,
  nodes,
  chosen,
  filters,
}: {
  idPrefix: string;
  fixedTrigger?: TriggerChoice["id"];
  triggerChoices: TriggerChoice[];
  nodes: { id: number; title: string; depth: number }[];
  chosen: number[];
  filters?: Filters;
}) {
  const t = useTranslations("adminEconomy.rules.form");
  const triggers = useTranslations("adminEconomy.rules.triggers");
  const [trigger, setTrigger] = useState(fixedTrigger ?? triggerChoices[0]?.id);
  const takesForums = triggerChoices.some(
    (choice) => choice.id === trigger && choice.acceptsForums,
  );
  const takesFilters = triggerChoices.some(
    (choice) => choice.id === trigger && choice.acceptsFilters,
  );
  const selected = new Set(chosen);
  return (
    <>
      <Field
        name="trigger"
        label={t("trigger")}
        htmlFor={`${idPrefix}-trigger`}
        help={fixedTrigger ? t("triggerFixed") : t("triggerHelp")}
      >
        {fixedTrigger ? (
          <>
            <input type="hidden" name="trigger" value={fixedTrigger} />
            <p
              id={`${idPrefix}-trigger`}
              className="flex min-h-10 items-center text-sm"
            >
              {triggers(fixedTrigger)}
            </p>
          </>
        ) : (
          <select
            id={`${idPrefix}-trigger`}
            name="trigger"
            value={trigger}
            onChange={(event) =>
              setTrigger(event.target.value as TriggerChoice["id"])
            }
            aria-describedby={`${idPrefix}-trigger-help ${idPrefix}-trigger-error`}
            className={selectClass}
          >
            {triggerChoices.map(({ id }) => (
              <option key={id} value={id}>
                {triggers(id)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {takesForums && (
        <Field name="nodeIds" label={t("forums")} help={t("forumsHelp")}>
          <fieldset className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            <legend className="sr-only">{t("forums")}</legend>
            {nodes.map((node) => (
              <label
                key={node.id}
                className="flex min-h-10 items-center gap-3 text-sm"
              >
                <input
                  type="checkbox"
                  name="nodeIds"
                  value={node.id}
                  defaultChecked={selected.has(node.id)}
                  className="size-5 shrink-0"
                />
                <span className="[overflow-wrap:anywhere]">
                  {"— ".repeat(node.depth)}
                  {node.title}
                </span>
              </label>
            ))}
          </fieldset>
        </Field>
      )}
      {takesFilters && (
        <Field name="filters" label={t("filters")} help={t("filtersHelp")}>
          <div className="grid gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span>{t("createdFrom")}</span>
              <Input
                type="date"
                name="createdFrom"
                aria-label={t("createdFromLabel")}
                defaultValue={filters?.createdFrom ?? undefined}
                className="w-40"
              />
              <span>{t("createdUntil")}</span>
              <Input
                type="date"
                name="createdUntil"
                aria-label={t("createdUntilLabel")}
                defaultValue={filters?.createdUntil ?? undefined}
                className="w-40"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>{t("lengthBetween")}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                name="minLength"
                aria-label={t("minLength")}
                defaultValue={filters?.minLength ?? undefined}
                className="w-28"
              />
              <span>{t("lengthAnd")}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                name="maxLength"
                aria-label={t("maxLength")}
                defaultValue={filters?.maxLength ?? undefined}
                className="w-28"
              />
              <span>{t("lengthUnit")}</span>
            </div>
          </div>
        </Field>
      )}
    </>
  );
}
