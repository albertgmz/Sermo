import type { awardsCriteria } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { FieldRow } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";

type Criterion = z.output<typeof awardsCriteria.output>["items"][number];

const checkbox = "size-5";

// CriteriaFields: the "criteria" row of a rule form. Each criterion the backend describes is a
// switch to use it and a control for its value chosen by its `kind` (a yes/no choice, an item id,
// or a number with its unit). The fields are `use:<id>` and `value:<id>`, read by `criteriaOf`.
//
// Props
//   namespace  The form's message namespace: `criteria`, `criteriaHelp`, `kinds.*`, `units.*`,
//              `holds`, `notHold` and `use`.
//   criteria   What the backend lists.
//   values     The value of each criterion the rule already uses, by criterion id.
//   showHelp   Whether to print each criterion's own help text under its switch.
export async function CriteriaFields({
  namespace,
  criteria,
  values,
  showHelp,
}: {
  namespace: "adminEconomy.awards.form" | "adminGroups.promotionForm";
  criteria: readonly Criterion[];
  values: ReadonlyMap<string, number>;
  showHelp: boolean;
}) {
  const t = await getTranslations(namespace);
  const kinds = {
    atLeast: t("kinds.atLeast"),
    atMost: t("kinds.atMost"),
    below: t("kinds.below"),
    boolean: "",
    item: t("kinds.item"),
  };
  const units = {
    count: t("units.count"),
    days: t("units.days"),
    points: t("units.points"),
    boolean: "",
    item: "",
  };
  return (
    <FieldRow name="criteria" label={t("criteria")} help={t("criteriaHelp")}>
      <div className="grid gap-2 lg:grid-cols-2">
        {criteria.map((definition) => {
          const id = `criterion-${definition.id}`;
          const current = values.get(definition.id);
          return (
            <div
              key={definition.id}
              className="space-y-2 rounded-lg border p-3"
            >
              <label className="flex min-h-10 items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`use:${definition.id}`}
                  defaultChecked={current !== undefined}
                  className={checkbox}
                />
                <span>
                  {definition.title}
                  <span className="sr-only"> ({t("use")})</span>
                </span>
              </label>
              {showHelp && definition.help && (
                <p className="text-xs text-pretty text-muted-foreground">
                  {definition.help}
                </p>
              )}
              {definition.kind === "boolean" ? (
                <select
                  id={id}
                  name={`value:${definition.id}`}
                  defaultValue={current ?? 1}
                  aria-label={definition.title}
                  className={selectClass}
                >
                  <option value={1}>{t("holds")}</option>
                  <option value={0}>{t("notHold")}</option>
                </select>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {kinds[definition.kind]}
                  </span>
                  <Input
                    id={id}
                    name={`value:${definition.id}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    aria-label={definition.title}
                    defaultValue={current ?? 0}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {units[definition.unit]}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </FieldRow>
  );
}
