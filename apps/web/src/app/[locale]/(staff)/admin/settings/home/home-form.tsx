import {
  HOME_TABS,
  MAX_HOME_TAB_RULES,
  nodesList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { ForumChecks } from "@/components/forum/forum-checks";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { saveHomeTab } from "../actions";
import { getSettings } from "../data";
import { Shown } from "../shown";

// The rules are rows of the form in the order they are stored, then one empty row to add a rule
// (while there is room). A row with no tab chosen is left out when the form is saved.
export async function HomeForm() {
  const [t, settings, nodes] = await Promise.all([
    getTranslations("adminSetup.pages.home"),
    getSettings(),
    read(nodesList, {}),
  ]);
  const { rules, fallback } = settings.homeTab;
  const rows = [...rules, ...(rules.length < MAX_HOME_TAB_RULES ? [null] : [])];
  const tabs = (
    <>
      {HOME_TABS.map((tab) => (
        <option key={tab} value={tab}>
          {t(`tabs.${tab}`)}
        </option>
      ))}
    </>
  );
  return (
    <EditForm action={saveHomeTab}>
      <FieldGroup legend={t("formHeading")}>
        {/* The rules and the fallback are one setting, replaced as a whole. */}
        <Shown name="homeTab" />
        {rows.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Fragment key={index}>
            <RuleField
              place="homeTab"
              name={`homeTab.rules.${index}.rule`}
              rule={entry?.rule}
              label={t("ruleRow", { n: index + 1 })}
              help={index === 0 ? undefined : null}
            />
            <Field
              name={`homeTab.rules.${index}.tab`}
              label={t("tabLabel")}
              htmlFor={`field-homeTab-${index}`}
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <select
                  id={`field-homeTab-${index}`}
                  name={`homeTab.rules.${index}.tab`}
                  defaultValue={entry?.tab ?? ""}
                  className={selectClass}
                >
                  <option value="">{t("noRule")}</option>
                  {tabs}
                </select>
                <Input
                  name={`homeTab.rules.${index}.position`}
                  type="number"
                  inputMode="numeric"
                  aria-label={t("positionLabel")}
                  placeholder={t("positionLabel")}
                  defaultValue={index + 1}
                  title={t("positionHelp")}
                />
              </div>
            </Field>
          </Fragment>
        ))}
        <Field
          name="homeTab.fallback"
          label={t("fallbackLabel")}
          htmlFor="field-homeTab-fallback"
          help={t("fallbackHelp")}
        >
          <select
            id="field-homeTab-fallback"
            name="homeTab.fallback"
            defaultValue={fallback}
            aria-describedby="field-homeTab-fallback-help"
            className={selectClass}
          >
            {tabs}
          </select>
        </Field>
        {/* The forums left out of the feed are one setting, replaced as a whole. */}
        <Shown name="feedExcludedForumIds" />
        <Field
          name="feedExcludedForumIds"
          label={t("excludedLabel")}
          help={t("excludedHelp")}
        >
          <ForumChecks
            name="feedExcludedForumIds"
            label={t("excludedLabel")}
            forums={nodes.items}
            checked={new Set(settings.feedExcludedForumIds)}
          />
        </Field>
      </FieldGroup>
    </EditForm>
  );
}
