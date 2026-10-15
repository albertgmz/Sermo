"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { type Choice, IdPicker } from "@/components/forum/id-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Available,
  addCondition,
  type Change,
  type Condition,
  type Criterion,
  changeCondition,
  controlFor,
  type Draft,
  draftOf,
  type Mode,
  numberOf,
  offeredCriteria,
  PLACES,
  type Place,
  type Rule,
  type RuleLimits,
  removeCondition,
  ruleOfDraft,
  takes,
} from "./criteria-rule";
import { selectClass } from "./rows";

// What a condition can name: the lists held in the page, and the names of the members and threads
// the rule already holds (the rest of those are found by searching).
export type RuleChoices = {
  groups: Choice[];
  items: Choice[];
  members: Choice[];
  threads: Choice[];
  awards: Choice[];
  shopCategories: Choice[];
  creditRules: Choice[];
  reactionTypes: Choice[];
};

// The search of threads the builder is given (a server action of the page that draws it).
export type FindThreads = (
  text: string,
) => Promise<{ id: number; title: string }[]>;

// The search of members the builder is given (a server action of the page that draws it).
export type FindMembers = (
  prefix: string,
) => Promise<{ id: number; username: string }[]>;

// RuleBuilder: the one editor of a rule, for every admin form that takes one. "All of these" or
// "Any of these", and a list of conditions to add and remove; each draws the control its criterion
// asks for (a number with its unit, a yes/no choice, a picker of groups, members or a shop item).
// The rule goes with the form as one JSON field named `name`, which the action reads with
// the shared schema, so a form saves without script as the rule it showed. Conditions are kept in
// order and never merged, and one the builder cannot draw (a criterion not offered in this place,
// an unknown one) is shown as it is and saved back unchanged.
//
// Props
//   place     Which form it is in (`PLACES`): decides which criteria are offered and what an empty
//             rule says.
//   criteria  What the backend lists (every criterion; the place filters).
//   rule      The rule being edited.
//   choices   The groups, shop items and members that conditions may name.
//   limits    What the shared schema allows: conditions in a rule, a condition's number, ids and
//             window.
//   findMembers  Finds members by the start of their username, for the member criteria.
//   findThreads  Finds threads by the words of their title, or by their number, for the thread
//                criteria.
//   name      The field the rule is sent in. Default "rule".
export function RuleBuilder({
  place,
  criteria,
  rule,
  choices,
  limits,
  findMembers,
  findThreads,
  name = "rule",
}: {
  place: Place;
  criteria: readonly Criterion[];
  rule: Rule;
  choices: RuleChoices;
  limits: RuleLimits;
  findMembers: FindMembers;
  findThreads: FindThreads;
  name?: string;
}) {
  const t = useTranslations("admin.ruleBuilder");
  const id = useId();
  // One function for the life of the builder: the picker restarts its search when it changes.
  const searchMembers = useMemo(
    () =>
      async (prefix: string): Promise<Choice[]> =>
        (await findMembers(prefix)).map((member) => ({
          id: member.id,
          label: member.username,
        })),
    [findMembers],
  );
  const searchThreads = useMemo(
    () =>
      async (text: string): Promise<Choice[]> =>
        (await findThreads(text)).map((thread) => ({
          id: thread.id,
          label: thread.title,
        })),
    [findThreads],
  );
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule));
  const [adding, setAdding] = useState("");
  const available: Available = {
    groups: choices.groups.length > 0,
    items: choices.items.length > 0,
    awards: choices.awards.length > 0,
    shopCategories: choices.shopCategories.length > 0,
    creditRules: choices.creditRules.length > 0,
    reactionTypes: choices.reactionTypes.length > 0,
  };
  const offered = offeredCriteria(criteria, place, available);
  const title = (criterion: string) =>
    criteria.find((entry) => entry.id === criterion)?.title ?? criterion;
  const empty = draft.entries.length === 0;
  const full = draft.entries.length >= limits.conditions;

  return (
    <div className="space-y-3">
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(ruleOfDraft(draft))}
      />
      {draft.entries.length > 1 && (
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
          <legend className="sr-only">{t("match.legend")}</legend>
          {(["all", "any"] as const).map((match) => (
            <label
              key={match}
              className="flex min-h-10 items-center gap-2 text-sm font-medium"
            >
              <input
                type="radio"
                name={`${id}-match`}
                checked={draft.match === match}
                onChange={() => setDraft((now) => ({ ...now, match }))}
                className="size-5"
              />
              {t(`match.${match}`)}
            </label>
          ))}
        </fieldset>
      )}
      {empty ? (
        <p
          data-empty={PLACES[place].empty}
          className={
            PLACES[place].empty === "required" ||
            PLACES[place].empty === "selection"
              ? "text-sm font-medium"
              : "text-sm text-muted-foreground"
          }
        >
          {t(`empty.${PLACES[place].empty}`)}
        </p>
      ) : (
        <ul className="space-y-2">
          {draft.entries.map(({ key, condition }) => {
            const criterion = controlFor(condition, offered);
            const labelId = `${id}-${key}`;
            return (
              <li key={key} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p
                    id={labelId}
                    className="min-w-0 pt-2.5 text-sm font-medium [overflow-wrap:anywhere]"
                  >
                    {title(condition.criterion)}
                  </p>
                  <button
                    type="button"
                    aria-label={t("remove", {
                      title: title(condition.criterion),
                    })}
                    onClick={() => setDraft((now) => removeCondition(now, key))}
                    className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {criterion?.help && (
                  <p className="text-xs text-pretty text-muted-foreground">
                    {criterion.help}
                  </p>
                )}
                {criterion ? (
                  <Control
                    criterion={criterion}
                    condition={condition}
                    labelId={labelId}
                    choices={choices}
                    limits={limits}
                    searchMembers={searchMembers}
                    searchThreads={searchThreads}
                    onChange={(input) =>
                      setDraft((now) => changeCondition(now, key, input))
                    }
                  />
                ) : (
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {t("kept", { detail: detailOf(condition) })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {full && (
        <p className="text-sm text-muted-foreground">
          {t("add.limit", { count: limits.conditions })}
        </p>
      )}
      {offered.length > 0 && !full && (
        <div className="flex gap-2">
          <select
            aria-label={t("add.label")}
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            className={selectClass}
          >
            <option value="">{t("add.choose")}</option>
            {offered.map((criterion) => (
              <option key={criterion.id} value={criterion.id}>
                {criterion.title}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            disabled={adding === ""}
            onClick={() => {
              const criterion = offered.find((entry) => entry.id === adding);
              if (!criterion) return;
              setDraft((now) => addCondition(now, criterion));
              setAdding("");
            }}
            className="min-h-10 shrink-0 px-3"
          >
            <Plus />
            {t("add.button")}
          </Button>
        </div>
      )}
    </div>
  );
}

// A condition as text, for one the builder does not draw.
function detailOf(condition: Condition) {
  const parts: string[] = [];
  if (condition.value !== undefined) parts.push(String(condition.value));
  if (condition.ids) parts.push(condition.ids.join(", "));
  if (condition.mode) parts.push(condition.mode);
  if (condition.days !== undefined) parts.push(`${condition.days}d`);
  return parts.join(" · ");
}

// The control of one condition, by what its criterion takes: yes/no, one shop item, or a list of
// ids to choose with a number, a window of days and the mode the list is read in.
function Control({
  criterion,
  condition,
  labelId,
  choices,
  limits,
  searchMembers,
  searchThreads,
  onChange,
}: {
  criterion: Criterion;
  condition: Condition;
  labelId: string;
  choices: RuleChoices;
  limits: RuleLimits;
  searchMembers: (prefix: string) => Promise<Choice[]>;
  searchThreads: (text: string) => Promise<Choice[]>;
  onChange: (input: Change) => void;
}) {
  const t = useTranslations("admin.ruleBuilder");
  const accepts = takes(criterion);
  const text = {
    chosen: criterion.title,
    search: `${criterion.title}: ${t("picker.search")}`,
    placeholder:
      criterion.idKind === "threads"
        ? t("picker.placeholderThreads")
        : t("picker.placeholder"),
    noMatch: t("picker.noMatch"),
    remove: (name: string) => t("picker.remove", { name }),
  };
  if (criterion.kind === "boolean")
    return (
      <select
        aria-labelledby={labelId}
        value={condition.value ?? 1}
        onChange={(event) => onChange({ value: Number(event.target.value) })}
        className={selectClass}
      >
        <option value={1}>{t("holds")}</option>
        <option value={0}>{t("notHold")}</option>
      </select>
    );
  if (criterion.kind === "item")
    return (
      <IdPicker
        single
        ids={condition.value === undefined ? [] : [condition.value]}
        known={choices.items}
        options={choices.items}
        text={text}
        onChange={([value]) => onChange({ value })}
      />
    );
  const list = {
    groups: { known: choices.groups, options: choices.groups },
    shopItems: { known: choices.items, options: choices.items },
    awards: { known: choices.awards, options: choices.awards },
    shopCategories: {
      known: choices.shopCategories,
      options: choices.shopCategories,
    },
    creditRules: { known: choices.creditRules, options: choices.creditRules },
    reactionTypes: {
      known: choices.reactionTypes,
      options: choices.reactionTypes,
    },
    members: { known: choices.members, search: searchMembers },
    threads: { known: choices.threads, search: searchThreads },
  };
  const unit = accepts.value
    ? t(`units.${criterion.unit as "count" | "days" | "points"}`)
    : "";
  return (
    <div className="space-y-2">
      {accepts.ids && (
        <IdPicker
          ids={condition.ids ?? []}
          {...list[accepts.ids]}
          limit={limits.ids}
          text={text}
          onChange={(ids) => onChange({ ids })}
        />
      )}
      {accepts.value && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {t(`kinds.${criterion.kind as "atLeast" | "atMost" | "below"}`)}
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={limits.value}
            required
            aria-labelledby={labelId}
            defaultValue={condition.value}
            onChange={(event) =>
              onChange({ value: numberOf(event.target.value, limits.value) })
            }
          />
          {unit && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {unit}
            </span>
          )}
        </div>
      )}
      {accepts.modes.length > 1 && (
        <select
          aria-label={`${criterion.title}: ${t("modes.label")}`}
          value={condition.mode ?? accepts.modes[0]}
          onChange={(event) => onChange({ mode: event.target.value as Mode })}
          className={selectClass}
        >
          {accepts.modes.map((mode) => (
            <option key={mode} value={mode}>
              {t(`modes.${mode}`)}
            </option>
          ))}
        </select>
      )}
      {accepts.window && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("window.within")}
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={limits.days}
            placeholder={t("window.ever")}
            aria-label={`${criterion.title}: ${t("window.label")}`}
            defaultValue={condition.days}
            onChange={(event) => {
              const days = numberOf(event.target.value, limits.days);
              onChange({ days: days === 0 ? undefined : days });
            }}
          />
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("units.days")}
          </span>
        </div>
      )}
    </div>
  );
}
