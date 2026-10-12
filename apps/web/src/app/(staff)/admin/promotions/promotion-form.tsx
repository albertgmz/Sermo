import type { promotionsGet } from "@sermo/core/contracts";
import { promotionsCriteria } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { getGroups } from "../groups/data";
import { savePromotion } from "./actions";

type Promotion = z.output<typeof promotionsGet.output>;
type Criterion = z.output<typeof promotionsCriteria.output>["items"][number];

const checkbox = "size-5";

// One criterion as the backend describes it: a switch to use it, and a control for its value
// chosen by `kind` (a yes/no choice, an item id, or a number with its unit).
function CriterionRow({
  definition,
  current,
  labels,
}: {
  definition: Criterion;
  current: number | undefined;
  labels: {
    kind: string;
    unit: string;
    holds: string;
    notHold: string;
    use: string;
  };
}) {
  const id = `criterion-${definition.id}`;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <label className="flex min-h-10 items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          name={`use:${definition.id}`}
          defaultChecked={current !== undefined}
          className={checkbox}
        />
        <span>
          {definition.title}
          <span className="sr-only"> ({labels.use})</span>
        </span>
      </label>
      {definition.help && (
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
          <option value={1}>{labels.holds}</option>
          <option value={0}>{labels.notHold}</option>
        </select>
      ) : (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {labels.kind}
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
            {labels.unit}
          </span>
        </div>
      )}
    </div>
  );
}

// The promotion form, for a new rule (no `promotion`) or one being edited. The criteria are
// whatever `promotions.criteria` lists; the target groups are every group.
export async function PromotionForm({ promotion }: { promotion?: Promotion }) {
  const [t, { items: criteria }, groups] = await Promise.all([
    getTranslations("adminGroups.promotionForm"),
    read(promotionsCriteria, {}),
    getGroups(),
  ]);
  const values = new Map(
    promotion?.criteria.map((entry) => [entry.criterion, entry.value]),
  );
  const chosen = new Set(promotion?.groupIds);
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
    <FormRows
      action={savePromotion}
      id={promotion ? undefined : "new"}
      heading={promotion ? t("headingEdit") : t("headingNew")}
      description={promotion ? undefined : t("descriptionNew")}
      submit={promotion ? undefined : t("create")}
    >
      {promotion && <input type="hidden" name="id" value={promotion.id} />}
      <FieldRow name="title" label={t("title")} htmlFor="promotion-title">
        <Input
          id="promotion-title"
          name="title"
          required
          defaultValue={promotion?.title}
        />
      </FieldRow>
      <FieldRow
        name="isActive"
        label={t("isActive")}
        htmlFor="promotion-active"
      >
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id="promotion-active"
            type="checkbox"
            name="isActive"
            defaultChecked={promotion ? promotion.isActive : true}
            className={checkbox}
          />
          {t("isActiveHelp")}
        </label>
      </FieldRow>
      <FieldRow name="criteria" label={t("criteria")} help={t("criteriaHelp")}>
        <div className="grid gap-2 lg:grid-cols-2">
          {criteria.map((definition) => (
            <CriterionRow
              key={definition.id}
              definition={definition}
              current={values.get(definition.id)}
              labels={{
                kind: kinds[definition.kind],
                unit: units[definition.unit],
                holds: t("holds"),
                notHold: t("notHold"),
                use: t("use"),
              }}
            />
          ))}
        </div>
      </FieldRow>
      <FieldRow name="groupIds" label={t("groups")} help={t("groupsHelp")}>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="sr-only">{t("groups")}</legend>
          {groups.map((group) => (
            <label
              key={group.id}
              className="flex min-h-10 items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                name="groupIds"
                value={group.id}
                defaultChecked={chosen.has(group.id)}
                className={checkbox}
              />
              {group.title}
            </label>
          ))}
        </fieldset>
      </FieldRow>
      <ConfirmPassword id="promotion-password" />
    </FormRows>
  );
}
