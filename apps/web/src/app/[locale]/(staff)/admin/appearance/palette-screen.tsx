import { paletteColorsList } from "@sermo/core/contracts";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { EmptyState } from "@/components/forum/empty-state";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Advanced, EditForm, FieldGroup } from "@/components/staff/edit-form";
import { ItemList, RowLink, RowToggle } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { SortForm } from "@/components/staff/sort-form";
import { isHexColor } from "@/lib/css-color";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  deleteColour,
  saveColour,
  saveColourOrder,
  setColourActive,
} from "./actions";
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
    <EditForm action={saveColour} submit={colour ? undefined : t("create")}>
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
        <ActiveField
          help={t("activeHelp")}
          defaultChecked={colour ? colour.isActive : true}
        />
      </FieldGroup>
      <Advanced fields={["position"]}>
        <PositionField idPrefix={key} defaultValue={colour?.position} />
      </Advanced>
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
        shown={["created", "saved", "ordered", "deleted", "deactivated"]}
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
          toggle: (
            <RowToggle
              action={setColourActive}
              fields={{ kind, id: String(colour.id) }}
              checked={colour.isActive}
              label={t("activeLabel", { name: colour.name })}
            />
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
  return <ColourForm kind={kind} colour={colour} />;
}

// The sort page: the colours with up and down arrows and one Save, through the order action.
export async function PaletteSort({ kind }: { kind: PaletteKindName }) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminAppearance.palette"),
    readPalette(kind),
  ]);
  if (items.length === 0) {
    return (
      <EmptyState title={t("none")} className="rounded-lg border bg-card" />
    );
  }
  return (
    <SortForm
      action={saveColourOrder}
      name="position.{id}"
      heading={t(`${PALETTE_KINDS[kind].key}.pageHeading`)}
      description={t("sortHelp")}
      items={items.map((colour) => ({
        id: colour.id,
        title: colour.name,
        position: colour.position,
        icon: <Swatch colour={colour} />,
        description: <code>{colour.color}</code>,
        fields: {
          kind,
          [`before.${colour.id}`]: colour.position,
          [`title.${colour.id}`]: colour.name,
        },
      }))}
    />
  );
}
