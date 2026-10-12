"use client";

// The trigger and the forum restriction of a credit rule's form. They live together because the
// forum list is shown only for the triggers that accept one. A rule that exists keeps its
// trigger, so the control then only shows it.

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FieldRow } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { TRIGGERS, type Trigger, takesForums } from "./triggers";

export function RuleFields({
  idPrefix,
  fixedTrigger,
  nodes,
  chosen,
}: {
  idPrefix: string;
  fixedTrigger?: Trigger;
  nodes: { id: number; title: string; depth: number }[];
  chosen: number[];
}) {
  const t = useTranslations("adminEconomy.rules.form");
  const triggers = useTranslations("adminEconomy.rules.triggers");
  const [trigger, setTrigger] = useState<Trigger>(fixedTrigger ?? TRIGGERS[0]);
  const selected = new Set(chosen);
  return (
    <>
      <FieldRow
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
            onChange={(event) => setTrigger(event.target.value as Trigger)}
            className={selectClass}
          >
            {TRIGGERS.map((value) => (
              <option key={value} value={value}>
                {triggers(value)}
              </option>
            ))}
          </select>
        )}
      </FieldRow>
      {takesForums(trigger) && (
        <FieldRow name="nodeIds" label={t("forums")} help={t("forumsHelp")}>
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
        </FieldRow>
      )}
    </>
  );
}
