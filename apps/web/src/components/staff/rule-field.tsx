import "server-only";

import {
  criteriaList,
  shopCategoriesList,
  shopItemsList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { memberNames } from "@/app/[locale]/(staff)/admin/logs/links";
import { call, read } from "@/lib/sermo/client";
import { everyone, type Place, type Rule } from "./criteria-rule";
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

// The row of an admin form that holds a rule, for the place it is in. It reads what the builder
// offers: the criteria and groups, the shop's items and the names of members the rule already
// names.
//
// Props
//   place  Which form it is (see `PLACES`).
//   rule   The rule being edited; none starts empty.
export async function RuleField({
  place,
  rule = everyone(),
}: {
  place: Place;
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
        place={place}
        criteria={criteria}
        rule={rule}
        choices={choices}
      />
    </FieldRow>
  );
}
