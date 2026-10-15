import "server-only";

import {
  criteriaList,
  MAX_CONDITION_DAYS,
  MAX_CONDITION_IDS,
  MAX_CONDITION_VALUE,
  MAX_RULE_CONDITIONS,
  shopCategoriesList,
  shopItemsList,
  threadsGet,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import { memberNames } from "@/app/[locale]/(staff)/admin/logs/links";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import {
  everyone,
  type Place,
  type Rule,
  type RuleLimits,
} from "./criteria-rule";
import { findThreads } from "./find-threads";
import { FieldRow } from "./form-rows";
import { RuleBuilder, type RuleChoices } from "./rule-builder";

// What a rule editor needs, once per request: the criteria, and the groups, awards and credit rules
// a rule may name. It is open to everyone who edits a rule, whichever of the four places they hold.
const getRuleKit = cache(() => read(criteriaList, {}));

// The shop's categories, and the items a condition may name: every category's first page of items,
// named with their category. The backend has no search over items.
const shopChoices = cache(async () => {
  const { items: categories } = await read(shopCategoriesList, {});
  const pages = await Promise.all(
    categories.map((category) =>
      call(shopItemsList, { categoryId: category.id, limit: 100 }),
    ),
  );
  return {
    categories: categories.map(({ id, name }) => ({ id, label: name })),
    items: categories.flatMap((category, index) =>
      (pages[index]?.items ?? []).map((item) => ({
        id: item.id,
        label: `${category.name}: ${item.name}`,
      })),
    ),
  };
});

// The titles of the threads a rule already names (the first few; a thread the visitor cannot see
// keeps no name and shows as its number).
const NAMED_THREADS = 50;
async function threadChoices(ids: number[]) {
  const named = await Promise.all(
    [...new Set(ids)].slice(0, NAMED_THREADS).map(async (id) => {
      try {
        const { thread } = await call(threadsGet, {
          threadId: id,
          countView: false,
        });
        return { id, label: thread.title };
      } catch (error) {
        if (!(error instanceof SermoError)) throw error;
        return null;
      }
    }),
  );
  return named.filter((choice) => choice !== null);
}

const limits: RuleLimits = {
  conditions: MAX_RULE_CONDITIONS,
  value: MAX_CONDITION_VALUE,
  ids: MAX_CONDITION_IDS,
  days: MAX_CONDITION_DAYS,
};

// The row of an admin form that holds a rule, for the place it is in. It reads what the builder
// offers: the criteria, groups, awards and credit rules, the shop's categories and items, and the
// names of the members and threads the rule already names.
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
  const [t, kit, shop] = await Promise.all([
    getTranslations("admin.ruleBuilder"),
    getRuleKit(),
    shopChoices(),
  ]);
  const { items: criteria, groups, awards, creditRules } = kit;
  const named = (idKind: string) => {
    const kinds = new Set(
      criteria.filter((entry) => entry.idKind === idKind).map(({ id }) => id),
    );
    return rule.conditions
      .filter((entry) => kinds.has(entry.criterion))
      .flatMap((entry) => entry.ids ?? []);
  };
  const memberIds = named("members");
  const [names, threads] = await Promise.all([
    memberIds.length > 0 ? memberNames(memberIds) : () => "",
    threadChoices(named("threads")),
  ]);
  const titled = ({ id, title }: { id: number; title: string }) => ({
    id,
    label: title,
  });
  const choices: RuleChoices = {
    groups: groups.map(titled),
    items: shop.items,
    members: memberIds.map((id) => ({ id, label: names(id) })),
    threads,
    // An award cannot require itself, so the one being edited is not offered.
    awards: awards
      .filter(({ id }) => place !== "award" || id !== owner)
      .map(titled),
    shopCategories: shop.categories,
    creditRules: creditRules.map(titled),
  };
  return (
    <FieldRow name="rule" label={t(`label.${place}`)} help={t(`help.${place}`)}>
      <RuleBuilder
        key={`${place}:${owner ?? "new"}:${JSON.stringify(rule)}`}
        place={place}
        criteria={criteria.map(
          ({ id, title, help, kind, unit, cost, idKind, window, modes }) => ({
            id,
            title,
            help,
            kind,
            unit,
            cost,
            idKind,
            window,
            modes,
          }),
        )}
        rule={rule}
        choices={choices}
        limits={limits}
        findMembers={findRecipients}
        findThreads={findThreads}
      />
    </FieldRow>
  );
}
