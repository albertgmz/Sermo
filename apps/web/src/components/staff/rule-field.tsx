import "server-only";

import {
  criteriaList,
  MAX_CONDITION_IDS,
  MAX_CONDITION_VALUE,
  MAX_RULE_CONDITIONS,
  shopCategoriesList,
  shopItemsList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { memberNames } from "@/app/[locale]/(staff)/admin/logs/links";
import { call, read } from "@/lib/sermo/client";
import {
  everyone,
  type Place,
  type Rule,
  type RuleLimits,
} from "./criteria-rule";
import { FieldRow } from "./form-rows";
import { RuleBuilder, type RuleChoices } from "./rule-builder";

// What a rule editor needs, once per request: the criteria and the groups a rule may name. It is
// open to everyone who edits a rule, whichever of the four places they hold.
const getRuleKit = cache(() => read(criteriaList, {}));

// The shop items a condition may name: every category's first page of items, named with their
// category. The backend has no search over items.
const shopItemChoices = cache(async () => {
  const { items: categories } = await read(shopCategoriesList, {});
  const pages = await Promise.all(
    categories.map((category) =>
      call(shopItemsList, { categoryId: category.id, limit: 100 }),
    ),
  );
  return categories.flatMap((category, index) =>
    (pages[index]?.items ?? []).map((item) => ({
      id: item.id,
      label: `${category.name}: ${item.name}`,
    })),
  );
});

const limits: RuleLimits = {
  conditions: MAX_RULE_CONDITIONS,
  value: MAX_CONDITION_VALUE,
  ids: MAX_CONDITION_IDS,
};

// The row of an admin form that holds a rule, for the place it is in. It reads what the builder
// offers: the criteria and groups, the shop's items and the names of members the rule already
// names.
//
// Props
//   place  Which form it is (see `PLACES`).
//   owner  The id of the record being edited; none for a new one. With the place and the rule it
//          keys the builder, so a form that stays on the page while another record is chosen
//          starts again from that record's rule instead of posting the draft of the last one.
//   rule   The rule being edited; none starts empty.
export async function RuleField({
  place,
  owner,
  rule = everyone(),
}: {
  place: Place;
  owner?: number | undefined;
  rule?: Rule | undefined;
}) {
  const [t, { items: criteria, groups }, items] = await Promise.all([
    getTranslations("admin.ruleBuilder"),
    getRuleKit(),
    shopItemChoices(),
  ]);
  const members = new Set(
    criteria.filter((entry) => entry.kind === "members").map(({ id }) => id),
  );
  const memberIds = rule.conditions
    .filter((entry) => members.has(entry.criterion))
    .flatMap((entry) => entry.ids ?? []);
  const names = memberIds.length > 0 ? await memberNames(memberIds) : () => "";
  const choices: RuleChoices = {
    groups: groups.map(({ id, title }) => ({ id, label: title })),
    items,
    members: memberIds.map((id) => ({ id, label: names(id) })),
  };
  return (
    <FieldRow name="rule" label={t(`label.${place}`)} help={t(`help.${place}`)}>
      <RuleBuilder
        key={`${place}:${owner ?? "new"}:${JSON.stringify(rule)}`}
        place={place}
        criteria={criteria.map(({ id, title, help, kind, unit, cost }) => ({
          id,
          title,
          help,
          kind,
          unit,
          cost,
        }))}
        rule={rule}
        choices={choices}
        limits={limits}
      />
    </FieldRow>
  );
}
