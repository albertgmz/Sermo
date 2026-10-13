"use client";

// The effect of a shop item and the settings that depend on it: which effect, the one catalog
// entry, colour, permission, group or number that effect needs, and whether the item is a
// consumable and how long it lasts. They are one component because they limit one another: a
// username change is sold in units (so it is always a consumable), a group is never a
// consumable, and a consumable has no duration. The form shows these limits instead of letting
// them be composed; the backend still decides and its refusal is shown.
//
// Only the fields of the chosen effect are rendered, so only those are submitted.

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FieldRow } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { isHexColor } from "@/lib/css-color";

export type EffectType =
  | "permission"
  | "group"
  | "frame"
  | "nameColor"
  | "threadCover"
  | "highlight"
  | "bump"
  | "usernameChange";

export type Initial = {
  type: EffectType;
  frameId?: number;
  colorId?: number;
  coverId?: number;
  groupId?: number;
  permission?: string;
  value?: number;
  days?: number;
};

type Picture = { id: number; name: string; picture: React.ReactNode };

export type EffectChoices = {
  frames: Picture[];
  covers: Picture[];
  colours: { id: number; name: string; color: string }[];
  groups: { id: number; title: string }[] | null;
  permissions:
    | {
        id: string;
        title: string;
        type: "flag" | "integer";
        unit: string | null;
      }[]
    | null;
};

const UNITS = ["seconds", "minutes", "hours", "days"] as const;

function PictureChoices({
  name,
  entries,
  chosen,
  empty,
}: {
  name: string;
  entries: Picture[];
  chosen: number | undefined;
  empty: string;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {entries.map((entry) => (
        <label
          key={entry.id}
          className="flex min-h-10 cursor-pointer flex-col gap-2 rounded-lg border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
        >
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name={name}
              value={entry.id}
              required
              defaultChecked={entry.id === chosen}
              className="size-5 shrink-0"
            />
            <span className="[overflow-wrap:anywhere]">{entry.name}</span>
          </span>
          {entry.picture}
        </label>
      ))}
    </fieldset>
  );
}

export function ItemEffect({
  idPrefix,
  types,
  initial,
  choices,
  consumable: initialConsumable,
  duration,
}: {
  idPrefix: string;
  types: readonly EffectType[];
  initial: Initial | null;
  choices: EffectChoices;
  consumable: boolean;
  duration: { amount: number; unit: (typeof UNITS)[number] } | null;
}) {
  const t = useTranslations("adminEconomy.items.form");
  const typeNames = useTranslations("adminEconomy.items.effects.types");
  const [type, setType] = useState<EffectType>(initial?.type ?? types[0]);
  const [consumable, setConsumable] = useState(initialConsumable);
  const [permission, setPermission] = useState(initial?.permission ?? "");

  const forced = type === "usernameChange";
  const barred = type === "group";
  const isConsumable = forced ? true : barred ? false : consumable;
  const selected = choices.permissions?.find(
    (entry) => entry.id === permission,
  );
  const typedPermission = choices.permissions === null;

  return (
    <>
      <FieldRow
        name="effect"
        label={t("effect")}
        htmlFor={`${idPrefix}-effect`}
        help={t(`effectHelp.${type}`)}
      >
        <select
          id={`${idPrefix}-effect`}
          name="effectType"
          value={type}
          onChange={(event) => setType(event.target.value as EffectType)}
          className={selectClass}
        >
          {types.map((value) => (
            <option key={value} value={value}>
              {typeNames(value)}
            </option>
          ))}
        </select>
      </FieldRow>

      {type === "frame" && (
        <FieldRow name="frameId" label={t("frame")}>
          <PictureChoices
            name="frameId"
            entries={choices.frames}
            chosen={initial?.frameId}
            empty={t("noFrames")}
          />
        </FieldRow>
      )}
      {type === "threadCover" && (
        <FieldRow name="coverId" label={t("cover")}>
          <PictureChoices
            name="coverId"
            entries={choices.covers}
            chosen={initial?.coverId}
            empty={t("noCovers")}
          />
        </FieldRow>
      )}
      {type === "nameColor" && (
        <FieldRow name="colorId" label={t("colour")}>
          {choices.colours.length > 0 ? (
            <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {choices.colours.map((entry) => (
                <label
                  key={entry.id}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                >
                  <input
                    type="radio"
                    name="colorId"
                    value={entry.id}
                    required
                    defaultChecked={entry.id === initial?.colorId}
                    className="size-5 shrink-0"
                  />
                  <span
                    aria-hidden="true"
                    className="size-5 shrink-0 rounded-full border"
                    style={
                      isHexColor(entry.color)
                        ? { backgroundColor: entry.color }
                        : undefined
                    }
                  />
                  <span className="[overflow-wrap:anywhere]">{entry.name}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noColours")}</p>
          )}
        </FieldRow>
      )}
      {type === "group" && (
        <FieldRow
          name="groupId"
          label={t("group")}
          htmlFor={`${idPrefix}-group`}
          help={choices.groups ? t("groupHelp") : t("groupTyped")}
        >
          {choices.groups ? (
            <select
              id={`${idPrefix}-group`}
              name="groupId"
              required
              defaultValue={initial?.groupId}
              className={selectClass}
            >
              <option value="" disabled>
                {t("chooseGroup")}
              </option>
              {choices.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${idPrefix}-group`}
              name="groupId"
              type="number"
              inputMode="numeric"
              min={1}
              required
              defaultValue={initial?.groupId}
            />
          )}
        </FieldRow>
      )}
      {type === "permission" && (
        <>
          <FieldRow
            name="permission"
            label={t("permission")}
            htmlFor={`${idPrefix}-permission`}
            help={typedPermission ? t("permissionTyped") : t("permissionHelp")}
          >
            {typedPermission ? (
              <Input
                id={`${idPrefix}-permission`}
                name="permission"
                required
                autoCapitalize="none"
                value={permission}
                onChange={(event) => setPermission(event.target.value)}
              />
            ) : (
              <select
                id={`${idPrefix}-permission`}
                name="permission"
                required
                value={permission}
                onChange={(event) => setPermission(event.target.value)}
                className={selectClass}
              >
                <option value="" disabled>
                  {t("choosePermission")}
                </option>
                {choices.permissions?.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} ({entry.id})
                  </option>
                ))}
              </select>
            )}
          </FieldRow>
          {(typedPermission || selected?.type === "integer") && (
            <FieldRow
              name="permissionValue"
              label={t("permissionValue")}
              htmlFor={`${idPrefix}-permission-value`}
              help={
                selected?.unit
                  ? t("permissionValueHelpUnit", { unit: selected.unit })
                  : t("permissionValueHelp")
              }
            >
              <Input
                id={`${idPrefix}-permission-value`}
                name="permissionValue"
                type="number"
                inputMode="numeric"
                min={-1}
                required={!typedPermission}
                defaultValue={initial?.value}
              />
            </FieldRow>
          )}
          {selected?.type === "flag" && (
            <p className="px-4 pb-2 text-xs text-muted-foreground sm:ps-[11.5rem]">
              {t("permissionFlag")}
            </p>
          )}
        </>
      )}
      {type === "highlight" && (
        <FieldRow
          name="days"
          label={t("days")}
          htmlFor={`${idPrefix}-days`}
          help={t("daysHelp")}
        >
          <Input
            id={`${idPrefix}-days`}
            name="days"
            type="number"
            inputMode="numeric"
            min={1}
            required
            defaultValue={initial?.days}
          />
        </FieldRow>
      )}

      <FieldRow
        name="isConsumable"
        label={t("consumable")}
        help={
          forced
            ? t("consumableForced")
            : barred
              ? t("consumableBarred")
              : t("consumableHelp")
        }
      >
        {forced && <input type="hidden" name="isConsumable" value="on" />}
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name={forced ? undefined : "isConsumable"}
            checked={isConsumable}
            disabled={forced || barred}
            onChange={(event) => setConsumable(event.target.checked)}
            className="size-5"
          />
          {t("consumableLabel")}
        </label>
      </FieldRow>
      <FieldRow
        name="durationSeconds"
        label={t("duration")}
        htmlFor={`${idPrefix}-duration`}
        help={isConsumable ? t("durationConsumable") : t("durationHelp")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="hidden"
            name="durationWas"
            value={duration ? `${duration.amount}:${duration.unit}` : ":days"}
          />
          <Input
            id={`${idPrefix}-duration`}
            name="durationAmount"
            type="number"
            inputMode="numeric"
            min={1}
            disabled={isConsumable}
            defaultValue={isConsumable ? undefined : duration?.amount}
            className="w-28"
          />
          <select
            name="durationUnit"
            aria-label={t("durationUnit")}
            disabled={isConsumable}
            defaultValue={duration?.unit ?? "days"}
            className={`${selectClass} w-32`}
          >
            {UNITS.filter(
              (unit) => unit !== "seconds" || duration?.unit === "seconds",
            ).map((unit) => (
              <option key={unit} value={unit}>
                {t(`units.${unit}`)}
              </option>
            ))}
          </select>
        </div>
      </FieldRow>
    </>
  );
}
