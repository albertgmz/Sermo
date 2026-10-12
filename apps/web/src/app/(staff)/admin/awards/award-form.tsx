import type { awardsGet } from "@sermo/core/contracts";
import { awardsCreate, awardsCriteria } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { AwardIcon } from "@/components/forum/award-icon";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { PictureField } from "@/components/staff/picture-field";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { saveAward } from "./actions";

export type Award = z.output<typeof awardsGet.output>;
type Criterion = z.output<typeof awardsCriteria.output>["items"][number];

const TIERS = awardsCreate.input.shape.tier.options;
const checkbox = "size-5";

// One criterion as the backend describes it: a switch to use it, and a control for its value
// chosen by its `kind` (a yes/no choice, a shop item id, or a number with its unit).
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
  const title = definition.title;
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
          {title}
          <span className="sr-only"> ({labels.use})</span>
        </span>
      </label>
      {definition.kind === "boolean" ? (
        <select
          id={id}
          name={`value:${definition.id}`}
          defaultValue={current ?? 1}
          aria-label={title}
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
            aria-label={title}
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

// The award form, for a new award (no `award`) or one being edited. The automatic criteria are
// whatever `awards.criteria` lists; none ticked means the award is given by hand only.
export async function AwardForm({ award }: { award?: Award }) {
  const [t, { items: criteria }] = await Promise.all([
    getTranslations("adminEconomy.awards.form"),
    read(awardsCriteria, {}),
  ]);
  const key = `award-${award?.id ?? "new"}`;
  const values = new Map(
    award?.criteria.map((entry) => [entry.criterion, entry.value]),
  );
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
      action={saveAward}
      id={award ? undefined : "new"}
      heading={award ? t("headingEdit") : t("headingNew")}
      description={award ? undefined : t("descriptionNew")}
      submit={award ? undefined : t("create")}
    >
      {award && <input type="hidden" name="id" value={award.id} />}
      <FieldRow name="name" label={t("name")} htmlFor={`${key}-name`}>
        <Input
          id={`${key}-name`}
          name="name"
          required
          maxLength={100}
          defaultValue={award?.name}
        />
      </FieldRow>
      <FieldRow
        name="description"
        label={t("description")}
        htmlFor={`${key}-description`}
      >
        <Input
          id={`${key}-description`}
          name="description"
          maxLength={500}
          defaultValue={award?.description}
        />
      </FieldRow>
      <FieldRow name="tier" label={t("tier")} htmlFor={`${key}-tier`}>
        <select
          id={`${key}-tier`}
          name="tier"
          defaultValue={award?.tier ?? TIERS[0]}
          className={selectClass}
        >
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {t(`tiers.${tier}`)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        name="xp"
        label={t("xp")}
        htmlFor={`${key}-xp`}
        help={t("xpHelp")}
      >
        <Input
          id={`${key}-xp`}
          name="xp"
          type="number"
          inputMode="numeric"
          min={0}
          required
          defaultValue={award?.xp ?? 0}
        />
      </FieldRow>
      <FieldRow
        name="credits"
        label={t("credits")}
        htmlFor={`${key}-credits`}
        help={t("creditsHelp")}
      >
        <Input
          id={`${key}-credits`}
          name="credits"
          type="number"
          inputMode="numeric"
          min={0}
          required
          defaultValue={award?.credits ?? 0}
        />
      </FieldRow>
      <FieldRow
        name="fileId"
        label={t("picture")}
        htmlFor={`${key}-file`}
        help={t("pictureHelp")}
      >
        <PictureField
          purpose="award_image"
          name="fileId"
          id={`${key}-file`}
          removable
          current={
            award?.image ? (
              <AwardIcon
                award={{
                  name: award.name,
                  icon: award.icon,
                  tier: award.tier,
                  image: award.image,
                }}
                size="lg"
              />
            ) : undefined
          }
        />
      </FieldRow>
      <FieldRow
        name="icon"
        label={t("icon")}
        htmlFor={`${key}-icon`}
        help={t("iconHelp")}
      >
        <Input
          id={`${key}-icon`}
          name="icon"
          maxLength={200}
          autoCapitalize="none"
          defaultValue={award?.icon}
        />
      </FieldRow>
      <FieldRow name="isStackable" label={t("stackable")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isStackable"
            defaultChecked={award?.isStackable ?? false}
            className={checkbox}
          />
          {t("stackableHelp")}
        </label>
      </FieldRow>
      <FieldRow name="isActive" label={t("active")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={award ? award.isActive : true}
            className={checkbox}
          />
          {t("activeHelp")}
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
    </FormRows>
  );
}
