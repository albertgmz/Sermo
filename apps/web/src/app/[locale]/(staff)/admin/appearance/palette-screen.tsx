import { paletteColorsList } from "@sermo/core/contracts";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { userNameProps } from "@/components/forum/user-name";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isHexColor } from "@/lib/css-color";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { deleteColour, saveColour } from "./actions";
import { ColourRows } from "./colour-rows";
import { ActiveField, NameField, PositionField } from "./entry-fields";
import { PALETTE_KINDS, type PaletteKindName } from "./kinds";

type Colour = z.output<typeof paletteColorsList.output>["items"][number];

// A catalog holds at most 500 colours and the backend does not page it: its entries in display
// order, inactive ones too.
const readPalette = (kind: PaletteKindName) =>
  read(paletteColorsList, { kind });

// The colour as a dot, for a row.
function Swatch({ colour }: { colour: Colour }) {
  return (
    <span
      aria-hidden="true"
      className="size-6 shrink-0 rounded-full border"
      style={
        isHexColor(colour.color) ? { backgroundColor: colour.color } : undefined
      }
    />
  );
}

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
      className="accent-scope"
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

// The form of a colour, for a new one (no `colour`) or a change. What the colour looks like in use
// is the preview of its rows; the display order is the advanced option.
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
    <EditForm
      action={saveColour}
      submit={colour ? undefined : t(`create.${kind}`)}
    >
      <input type="hidden" name="kind" value={kind} />
      {colour && <input type="hidden" name="id" value={colour.id} />}
      <FieldGroup legend={t("group")}>
        <NameField idPrefix={key} defaultValue={colour?.name} />
        <ColourRows
          kind={kind}
          idPrefix={key}
          color={colour?.color ?? ""}
          foreground={colour?.foreground ?? ""}
        />
        <PositionField idPrefix={key} defaultValue={colour?.position} />
        <ActiveField
          help={t("activeHelp")}
          defaultChecked={colour ? colour.isActive : true}
        />
      </FieldGroup>
    </EditForm>
  );
}

// One colour palette: its entries as rows with the active switch, the edit link and the delete.
export async function PaletteList({
  kind,
  searchParams,
}: {
  kind: PaletteKindName;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminAppearance.palette"),
    readPalette(kind),
  ]);
  const { key, path } = PALETTE_KINDS[kind];
  return (
    <>
      <Notice
        namespace="adminAppearance.notices"
        searchParams={searchParams}
        shown={["created", "saved", "deleted", "deactivated"]}
      />
      <ItemList
        label={t(`${key}.pageHeading`)}
        filter
        empty={{ title: t("none") }}
        items={items.map((colour) => ({
          id: colour.id,
          icon: <Swatch colour={colour} />,
          title: colour.name,
          href: `${path}/${colour.id}`,
          search: `${colour.name} ${colour.color}`,
          description: (
            <>
              <code>{colour.color}</code>
              {` · ${t("order", { position: colour.position })}`}
            </>
          ),
          badges: colour.isActive ? (
            <Badge variant="success">{t("active")}</Badge>
          ) : (
            <Badge variant="outline">{t("inactive")}</Badge>
          ),
          actions: (
            <>
              <RowLink
                href={`${path}/${colour.id}`}
                label={t("editLabel", { name: colour.name })}
              />
              <ConfirmStep
                action={deleteColour}
                fields={{ kind, id: colour.id }}
                summary={`${t("delete")}…`}
                warning={t("deleteWarning")}
                submit={t("delete")}
              />
            </>
          ),
        }))}
      />
    </>
  );
}

// The page of a new colour (no `params`) or of the colour the address names.
export async function PaletteEdit({
  kind,
  params,
}: {
  kind: PaletteKindName;
  params?: Promise<{ id: string }>;
}) {
  if (!params) return <ColourForm kind={kind} />;
  const [{ id }, { items }] = await Promise.all([params, readPalette(kind)]);
  const colour = items.find((item) => item.id === parseId(id));
  if (!colour) notFound();
  const t = await getTranslations("adminAppearance.palette");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <span className="text-xs text-muted-foreground">{t("looks")}</span>
        <Sample kind={kind} colour={colour} />
      </div>
      <ColourForm kind={kind} colour={colour} />
    </div>
  );
}
