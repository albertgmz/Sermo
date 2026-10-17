"use client";

// ColourRows: the colour rows of a palette entry's form, with a live preview. Render it inside the
// `FieldGroup` of an `EditForm`; the action reads `color` and, for an accent, `foreground`, as typed.
//
// Props
//   kind        "accent", "name" or "prefix": decides what the preview draws and whether there is a
//               foreground (the colour of the text on an accent).
//   idPrefix    Prefix of the controls' ids (one per entry on a page).
//   color       The colour now (#rrggbb), or "" for a new entry.
//   foreground  The accent's foreground now, or "".
//
// Each colour is a text field for the value the backend accepts (#rrggbb) and the browser's colour
// input, kept in sync. The preview shows the colour on the two surfaces of the theme, drawn with
// the public site's own pieces: a name colour on a member name, an accent on a button, a prefix
// colour on a prefix tag. A value reaches the preview's styles only if it is a #rrggbb colour.

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { userNameProps } from "@/components/forum/user-name";
import { Field } from "@/components/staff/edit-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isHexColor } from "@/lib/css-color";
import { cn } from "@/lib/utils";

function ColourInput({
  id,
  name,
  value,
  onChange,
  label,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        maxLength={7}
        placeholder="#rrggbb"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        className="max-w-40 font-mono"
      />
      <input
        type="color"
        aria-label={label}
        value={isHexColor(value) ? value.toLowerCase() : "#000000"}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1"
      />
    </div>
  );
}

function Sample({
  kind,
  color,
  foreground,
  surface,
}: {
  kind: "accent" | "name" | "prefix";
  color: string;
  foreground: string;
  surface: string;
}) {
  const t = useTranslations("adminAppearance.colourRows");
  const valid = isHexColor(color);
  return (
    <div
      className={cn(
        "flex min-h-14 flex-1 items-center justify-center rounded-lg border p-3",
        surface,
      )}
    >
      {kind === "name" && (
        <span
          className={cn(
            "font-semibold",
            valid ? userNameProps({ nameColor: color }).className : undefined,
          )}
          style={valid ? userNameProps({ nameColor: color }).style : undefined}
        >
          {t("sampleName")}
        </span>
      )}
      {kind === "prefix" && (
        <PrefixTag
          prefix={{
            label: t("samplePrefix"),
            color: valid ? color : "transparent",
            icon: "",
          }}
        />
      )}
      {kind === "accent" && (
        <Button
          type="button"
          tabIndex={-1}
          className="accent-scope"
          style={
            valid
              ? ({
                  "--primary": color,
                  "--primary-foreground": isHexColor(foreground)
                    ? foreground
                    : undefined,
                } as React.CSSProperties)
              : undefined
          }
        >
          {t("sampleButton")}
        </Button>
      )}
    </div>
  );
}

export function ColourRows({
  kind,
  idPrefix,
  color: initialColor,
  foreground: initialForeground,
}: {
  kind: "accent" | "name" | "prefix";
  idPrefix: string;
  color: string;
  foreground: string;
}) {
  const t = useTranslations("adminAppearance.colourRows");
  const [color, setColor] = useState(initialColor);
  const [foreground, setForeground] = useState(initialForeground);
  return (
    <>
      <Field
        name="color"
        label={t("color")}
        htmlFor={`${idPrefix}-color`}
        help={t("colorHelp")}
      >
        <ColourInput
          id={`${idPrefix}-color`}
          name="color"
          value={color}
          onChange={setColor}
          label={t("picker")}
        />
      </Field>
      {kind === "accent" && (
        <Field
          name="foreground"
          label={t("foreground")}
          htmlFor={`${idPrefix}-foreground`}
          help={t("foregroundHelp")}
        >
          <ColourInput
            id={`${idPrefix}-foreground`}
            name="foreground"
            value={foreground}
            onChange={setForeground}
            label={t("pickerForeground")}
          />
        </Field>
      )}
      <Field name="preview" label={t("preview")}>
        <div
          role="img"
          aria-label={t("previewLabel")}
          className="flex flex-wrap gap-2"
        >
          <Sample
            kind={kind}
            color={color}
            foreground={foreground}
            surface="bg-background"
          />
          <Sample
            kind={kind}
            color={color}
            foreground={foreground}
            surface="bg-card"
          />
        </div>
      </Field>
    </>
  );
}
