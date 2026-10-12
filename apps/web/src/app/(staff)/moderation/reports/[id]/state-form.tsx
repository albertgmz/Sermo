"use client";

import { useTranslations } from "next-intl";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { NoticeFields } from "../../notice-fields";
import { setReportState } from "./actions";

// The form that changes the state of a report case. `states` are the values the contract takes.
export function StateForm({
  groupId,
  states,
  current,
}: {
  groupId: number;
  states: readonly string[];
  current: string;
}) {
  const t = useTranslations("moderation.case");
  const state = useTranslations("moderation.common.state");
  return (
    <FormRows
      action={setReportState}
      heading={t("formHeading")}
      description={t("formDescription")}
      submit={t("submit")}
      id="decide"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <FieldRow
        name="state"
        label={t("stateLabel")}
        htmlFor="case-state"
        help={t("stateHelp")}
      >
        <select
          id="case-state"
          name="state"
          defaultValue={states.includes(current) ? current : "resolved"}
          className={selectClass}
        >
          {states.map((value) => (
            <option key={value} value={value}>
              {state(value as "open")}
            </option>
          ))}
        </select>
      </FieldRow>
      <NoticeFields idPrefix="case" />
    </FormRows>
  );
}
