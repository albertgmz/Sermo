"use client";

// PlacementEditor: the numbers that place a frame around an avatar, with a live preview. Render it
// inside the frame's form (`FormRows`); the action reads `width`, `left`, `top` and `scale`, and
// `before.<name>` (what the form started with, so it can tell what was changed).
//
// Props
//   idPrefix   Prefix of the controls' ids (one per frame on a page).
//   frame      The frame picture drawn by the server through the LITE gate (an `Art` with category
//              "frames" that fills its box), or null when there is none to draw (a new frame).
//   aspect     Width over height of the frame picture, to give the box the picture fills.
//   initial    The placement the frame has now (measured, or adjusted), or null for a new frame,
//              whose numbers start empty and are optional: the backend measures them.
//   canReset   Whether to offer "Reset to measured": a submit button named `intent` with the value
//              `reset`, which the action turns into `placement: null`.
//
// The preview draws the same markup as the avatar of the public site (`UserAvatar`): the frame is
// `width` percent of the avatar box wide, its corner at (`left`, `top`), and the picture shrinks
// to `scale` percent.

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const NAMES = ["width", "left", "top", "scale"] as const;
type Name = (typeof NAMES)[number];

export type Placement = Record<Name, number>;

const parse = (raw: string) =>
  /^-?\d{1,6}(\.\d{1,4})?$/.test(raw.trim()) ? Number(raw.trim()) : null;

export function PlacementEditor({
  idPrefix,
  frame,
  aspect,
  initial,
  canReset,
}: {
  idPrefix: string;
  frame: React.ReactNode;
  aspect: number;
  initial: Placement | null;
  canReset: boolean;
}) {
  const t = useTranslations("adminAppearance.placement");
  const [values, setValues] = useState<Record<Name, string>>(
    () =>
      Object.fromEntries(
        NAMES.map((name) => [name, initial ? String(initial[name]) : ""]),
      ) as Record<Name, string>,
  );
  const numbers = NAMES.map((name) => parse(values[name]));
  const live =
    numbers.every((value) => value !== null) &&
    (numbers as number[]).every((value) => Number.isFinite(value))
      ? ({
          width: numbers[0],
          left: numbers[1],
          top: numbers[2],
          scale: numbers[3],
        } as Placement)
      : null;
  const shown = live ?? initial;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {NAMES.map((name) => (
          <div key={name} className="min-w-0 space-y-1">
            <label htmlFor={`${idPrefix}-${name}`} className="text-xs">
              {t(name)}
            </label>
            <input
              type="hidden"
              name={`before.${name}`}
              value={initial ? String(initial[name]) : ""}
            />
            <Input
              id={`${idPrefix}-${name}`}
              name={name}
              inputMode="decimal"
              autoComplete="off"
              value={values[name]}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [name]: event.target.value,
                }))
              }
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("help")}</p>
      {frame && shown && (
        <div className="flex items-center gap-4">
          <div
            role="img"
            aria-label={t("preview")}
            className="flex size-36 items-center justify-center rounded-lg bg-background"
          >
            <Avatar className="size-24 after:hidden">
              <AvatarFallback
                className="text-3xl font-semibold uppercase"
                style={{ scale: shown.scale / 100 }}
              >
                {t("sample")}
              </AvatarFallback>
              <span
                className="pointer-events-none absolute"
                style={{
                  width: `${shown.width}%`,
                  left: `${shown.left}%`,
                  top: `${shown.top}%`,
                  aspectRatio: aspect,
                }}
              >
                {frame}
              </span>
            </Avatar>
          </div>
          <p className="text-xs text-muted-foreground">{t("previewHelp")}</p>
        </div>
      )}
      {canReset && (
        <Button
          type="submit"
          name="intent"
          value="reset"
          variant="outline"
          formNoValidate
          className="min-h-10 px-4"
        >
          {t("reset")}
        </Button>
      )}
    </div>
  );
}
