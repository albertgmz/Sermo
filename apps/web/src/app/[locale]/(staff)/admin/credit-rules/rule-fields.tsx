"use client";

// The trigger and the forum restriction of a credit rule's form. They live together because the
// forum list is shown only for the triggers that accept one. A rule that exists keeps its
// trigger, so the control then only shows it.

import type { creditRulesList } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type * as z from "zod";
import { Field } from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";

// The triggers a rule can have, as the backend lists them, and whether a rule on each may be
// restricted to forums.
export type TriggerChoice = z.output<
  typeof creditRulesList.output
>["triggers"][number];

export function RuleFields({
  idPrefix,
  fixedTrigger,
  triggerChoices,
  nodes,
  chosen,
}: {
  idPrefix: string;
  fixedTrigger?: TriggerChoice["id"];
  triggerChoices: TriggerChoice[];
  nodes: { id: number; title: string; depth: number }[];
  chosen: number[];
}) {
  const t = useTranslations("adminEconomy.rules.form");
  const triggers = useTranslations("adminEconomy.rules.triggers");
  const [trigger, setTrigger] = useState(fixedTrigger ?? triggerChoices[0]?.id);
  const takesForums = triggerChoices.some(
    (choice) => choice.id === trigger && choice.acceptsForums,
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
    </>
  );
}
