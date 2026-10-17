import { wordFiltersList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
import { removeWordFilter, saveWordFilter } from "../actions";
import { FilterFields } from "../filter-fields";

type Props = PageProps<"/[locale]/admin/word-filters/[id]">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.wordFilters.edit");
  return { title: t("metaTitle") };
}

// The filter by its id among all of them (the backend reads them only as a list). Only a holder of
// wordFilter.manage edits; the others have no link here.
async function EditFilter({ params }: Pick<Props, "params">) {
  const filterId = parseId((await params).id);
  if (filterId === null) notFound();
  const [t, viewer, { items }] = await Promise.all([
    getTranslations("adminContent.wordFilters"),
    getViewer(),
    read(wordFiltersList, {}),
  ]);
  if (viewer.resolvedPermissions["wordFilter.manage"] !== true) notFound();
  const filter = items.find((item) => item.id === filterId);
  if (!filter) notFound();
  return (
    <>
      <EditForm action={saveWordFilter}>
        <FieldGroup legend={t("fields.group")}>
          <FilterFields filter={filter} />
        </FieldGroup>
      </EditForm>
      <ConfirmStep
        heading={t("edit.deleteHeading")}
        action={removeWordFilter}
        fields={{ id: String(filter.id) }}
        summary={t("list.remove")}
        warning={t("list.removeWarning")}
        submit={t("list.remove")}
      />
    </>
  );
}

export default function EditFilterPage({ params }: Props) {
  const t = useTranslations("adminContent.wordFilters");
  return (
    <ScreenFrame
      heading={t("edit.heading")}
      subtitle={t("edit.description")}
      trail={params.then(({ id }) => staffTrail(`/admin/word-filters/${id}`))}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <EditFilter params={params} />
    </ScreenFrame>
  );
}
