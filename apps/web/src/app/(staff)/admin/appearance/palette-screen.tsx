import { paletteColorsList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { userNameProps } from "@/components/forum/user-name";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isHexColor } from "@/lib/css-color";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";
import { deleteColour, saveColour } from "./actions";
import { ColourRows } from "./colour-rows";
import { PALETTE_KINDS, type PaletteKindName } from "./kinds";

type Colour = z.output<typeof paletteColorsList.output>["items"][number];

// What the colour looks like in use, drawn with the public site's own pieces.
async function Sample({
  kind,
  colour,
}: {
  kind: PaletteKindName;
  colour: Colour;
}) {
  const t = await getTranslations("adminAppearance.palette");
  if (!isHexColor(colour.color)) return null;
  if (kind === "prefix") {
    return (
      <PrefixTag
        prefix={{ label: t("samplePrefix"), color: colour.color, icon: "" }}
      />
    );
  }
  if (kind === "name") {
    const name = userNameProps({ nameColor: colour.color });
    return (
      <span
        className={cn("text-sm font-semibold", name.className)}
        style={name.style}
      >
        {t("sampleName")}
      </span>
    );
  }
  return (
    <Button
      type="button"
      tabIndex={-1}
      size="sm"
      style={
        {
          "--primary": colour.color,
          "--primary-foreground": isHexColor(colour.foreground)
            ? colour.foreground
            : undefined,
        } as React.CSSProperties
      }
    >
      {t("sampleButton")}
    </Button>
  );
}

// The form of a colour, for a new one (no `colour`) or a change.
async function ColourForm({
  kind,
  colour,
}: {
  kind: PaletteKindName;
  colour?: Colour;
}) {
  const t = await getTranslations("adminAppearance.colourForm");
  const key = `colour-${colour?.id ?? "new"}`;
  return (
    <FormRows
      action={saveColour}
      id={colour ? undefined : "new"}
      heading={colour ? t("headingEdit") : t("headingNew")}
      description={colour ? undefined : t(`descriptionNew.${kind}`)}
      submit={colour ? undefined : t("create")}
    >
      <input type="hidden" name="kind" value={kind} />
      {colour && <input type="hidden" name="id" value={colour.id} />}
      <FieldRow name="name" label={t("name")} htmlFor={`${key}-name`}>
        <Input
          id={`${key}-name`}
          name="name"
          required
          defaultValue={colour?.name}
        />
      </FieldRow>
      <ColourRows
        kind={kind}
        idPrefix={key}
        color={colour?.color ?? ""}
        foreground={colour?.foreground ?? ""}
      />
      <FieldRow
        name="position"
        label={t("position")}
        htmlFor={`${key}-position`}
      >
        <Input
          id={`${key}-position`}
          name="position"
          type="number"
          inputMode="numeric"
          defaultValue={colour?.position}
        />
      </FieldRow>
      <FieldRow name="isActive" label={t("active")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={colour ? colour.isActive : true}
            className="size-5"
          />
          {t("activeHelp")}
        </label>
      </FieldRow>
    </FormRows>
  );
}

// One colour catalog: its entries in display order (inactive ones too), each with its editor and
// its delete behind a disclosure, then the form for a new colour. A catalog holds at most 500
// entries and the backend does not page it.
export async function PaletteScreen({
  kind,
  searchParams,
}: {
  kind: PaletteKindName;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminAppearance.palette"),
    read(paletteColorsList, { kind }),
  ]);
  const key = PALETTE_KINDS[kind].key;
  return (
    <>
      <Notice
        namespace="adminAppearance.notices"
        searchParams={searchParams}
        shown={["created", "saved", "deleted", "deactivated"]}
      />
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t(`${key}.heading`)}</h2>
          <p className="text-xs text-muted-foreground">
            {t(`${key}.description`)}
          </p>
        </div>
        {items.length > 0 ? (
          <ul aria-label={t(`${key}.heading`)} className="divide-y">
            {items.map((colour) => (
              <li key={colour.id}>
                <details>
                  <summary className="flex min-h-14 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                    <span
                      aria-hidden="true"
                      className="size-6 shrink-0 rounded-full border"
                      style={
                        isHexColor(colour.color)
                          ? { backgroundColor: colour.color }
                          : undefined
                      }
                    />
                    <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                      {colour.name}
                    </span>
                    <code className="text-xs text-muted-foreground">
                      {colour.color}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      {t("order", { position: colour.position })}
                    </span>
                    {!colour.isActive && (
                      <Badge variant="outline">{t("inactive")}</Badge>
                    )}
                    <span className="ms-auto text-sm font-medium text-primary">
                      {t("edit")}
                    </span>
                  </summary>
                  <div className="space-y-4 border-t p-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {t("looks")}
                      </span>
                      <Sample kind={kind} colour={colour} />
                    </div>
                    <ColourForm kind={kind} colour={colour} />
                    <div className="rounded-lg border border-destructive/30 px-4 py-1">
                      <ConfirmStep
                        action={deleteColour}
                        fields={{ kind, id: colour.id }}
                        summary={`${t("delete")}…`}
                        warning={t("deleteWarning")}
                        submit={t("delete")}
                      />
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        )}
      </section>
      <ColourForm kind={kind} />
    </>
  );
}
