import { usersCards } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { read } from "@/lib/sermo/client";
import { saveLevels } from "../actions";
import { getSettings } from "../data";
import { NumberRow, SwitchRow } from "../fields";
import { Shown } from "../shown";
import { Subheading } from "../subheading";

// Empty rows after the stored titles, for adding some.
const SPARE_ROWS = 3;

// The cards endpoint takes at most this many ids.
const CARDS_PER_CALL = 100;

// The usernames of the members left out, in the order they are stored; one that no longer exists
// is dropped.
async function excludedNames(ids: number[]): Promise<string[]> {
  const found = new Map<number, string>();
  for (let at = 0; at < ids.length; at += CARDS_PER_CALL) {
    const userIds = ids.slice(at, at + CARDS_PER_CALL);
    for (const card of (await read(usersCards, { userIds })).items)
      found.set(card.id, card.username);
  }
  return ids.flatMap((id) => found.get(id) ?? []);
}

export async function LevelsForm() {
  const [t, f, settings] = await Promise.all([
    getTranslations("adminSetup.pages.levels"),
    getTranslations("adminSetup.fields"),
    getSettings(),
  ]);
  const excluded = await excludedNames(settings.standingExcludedUserIds);
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
      <SwitchRow
        name="standingExcludeStaff"
        value={settings.standingExcludeStaff}
      />
      <Shown name="standingExcludedUserIds" />
      <FieldRow
        name="standingExcludedUserIds"
        label={f("standingExcludedUserIds.label")}
        htmlFor="field-standingExcludedUserIds"
        help={f("standingExcludedUserIds.help")}
      >
        <Textarea
          id="field-standingExcludedUserIds"
          name="standingExcludedUserIds"
          rows={3}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={excluded.join("\n")}
          aria-describedby="field-standingExcludedUserIds-help"
        />
      </FieldRow>
    </FormRows>
  );
}
