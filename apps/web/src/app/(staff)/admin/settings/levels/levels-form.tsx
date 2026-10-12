import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { saveLevels } from "../actions";
import { getSettings } from "../data";
import { NumberRow } from "../fields";
import { Shown } from "../shown";
import { Subheading } from "../subheading";

// Empty rows after the stored titles, for adding some.
const SPARE_ROWS = 3;

export async function LevelsForm() {
  const [t, f, settings] = await Promise.all([
    getTranslations("adminSetup.pages.levels"),
    getTranslations("adminSetup.fields"),
    getSettings(),
  ]);
  const rows = [
    ...settings.levelTitles,
    ...Array.from({ length: SPARE_ROWS }, () => null),
  ];
  return (
    <FormRows action={saveLevels} heading={t("formHeading")}>
      <Subheading heading={t("curve")} description={t("noPreview")} />
      <NumberRow name="levelStep" value={settings.levelStep} />
      {/* The title rows are one setting: the list is replaced only by a form that shows it. */}
      <Shown name="levelTitles" />
      {rows.map((entry, index) => (
        <FieldRow
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          key={index}
          name={`levelTitles.${index}`}
          label={t("titleRow", { n: index + 1 })}
          htmlFor={`field-level-${index}`}
          help={index === 0 ? f("levelTitles.help") : undefined}
        >
          <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Input
              id={`field-level-${index}`}
              name={`levelTitles.${index}.level`}
              type="number"
              inputMode="numeric"
              aria-label={t("levelLabel")}
              placeholder={t("levelLabel")}
              defaultValue={entry?.level}
            />
            <Input
              name={`levelTitles.${index}.title`}
              aria-label={t("titleLabel")}
              placeholder={t("titleLabel")}
              defaultValue={entry?.title}
            />
          </div>
        </FieldRow>
      ))}
      <Subheading heading={t("limits")} />
      <NumberRow
        name="signatureMaxLength"
        value={settings.signatureMaxLength}
      />
      <NumberRow name="signatureMaxLines" value={settings.signatureMaxLines} />
      <NumberRow
        name="customTitleMaxLength"
        value={settings.customTitleMaxLength}
      />
      <Subheading heading={t("standing")} />
      <NumberRow
        name="standingPostPoints"
        value={settings.standingPostPoints}
      />
      <NumberRow
        name="standingReactionsPerPoint"
        value={settings.standingReactionsPerPoint}
      />
      <NumberRow
        name="standingReferralPoints"
        value={settings.standingReferralPoints}
      />
    </FormRows>
  );
}
