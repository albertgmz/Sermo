import "server-only";

import {
  awardsCriteria,
  promotionsCriteria,
  shopCategoriesList,
  shopItemsList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { groupsIfAllowed } from "@/app/[locale]/(staff)/admin/groups/data";
import { memberNames } from "@/app/[locale]/(staff)/admin/logs/links";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import {
  type Criterion,
  everyone,
  type Place,
  type Rule,
} from "./criteria-rule";
import { FieldRow } from "./form-rows";
import { RuleBuilder, type RuleChoices } from "./rule-builder";

// The criteria the backend lists, once per request. Two screens publish the list (promotions and
// awards); the rule of a notice or a shop entry is edited by people who may hold neither, so
// either is asked in turn. Null when the viewer may read neither.
export const getCriteria = cache(async (): Promise<Criterion[] | null> => {
  const refused = (error: unknown) =>
    error instanceof SermoError && error.code === "forbidden";
  try {
    return (await call(awardsCriteria, {})).items;
  } catch (error) {
    if (!refused(error)) throw error;
  }
  try {
    return (await call(promotionsCriteria, {})).items;
  } catch (error) {
    if (!refused(error)) throw error;
  }
  return null;
});

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
// offers (the criteria, groups, shop items and the names of members the rule already names). A
// viewer who may not read the criteria gets the rule back as it is, in a hidden field.
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
  const [t, criteria] = await Promise.all([
    getTranslations("admin.ruleBuilder"),
    getCriteria(),
  ]);
  const members = new Set(
    criteria?.filter((entry) => entry.kind === "members").map(({ id }) => id),
  );
  const memberIds = rule.conditions
    .filter((entry) => members.has(entry.criterion))
    .flatMap((entry) => entry.ids ?? []);
  const [groups, items, names] = criteria
    ? await Promise.all([
        groupsIfAllowed(),
        shopItemChoices(),
        memberIds.length > 0 ? memberNames(memberIds) : () => "",
      ])
    : [null, [], () => ""];
  const choices: RuleChoices = {
    groups: groups?.map(({ id, title }) => ({ id, label: title })) ?? null,
    items,
    members: memberIds.map((id) => ({ id, label: names(id) })),
  };
  return (
    <FieldRow name="rule" label={t(`label.${place}`)} help={t(`help.${place}`)}>
      {criteria ? (
        <RuleBuilder
          place={place}
          criteria={criteria}
          rule={rule}
          choices={choices}
        />
      ) : (
        <>
          <input type="hidden" name="rule" value={JSON.stringify(rule)} />
          <p className="text-sm text-muted-foreground">{t("unreadable")}</p>
        </>
      )}
    </FieldRow>
  );
}
