import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { getViewer } from "@/lib/sermo/session";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
import { saveWordFilter } from "../actions";
import { FilterFields } from "../filter-fields";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.wordFilters.create");
  return { title: t("metaTitle") };
}

// Only a holder of wordFilter.manage adds filters; the others have no link here.
async function NewFilter() {
  const [t, viewer] = await Promise.all([
    getTranslations("adminContent.wordFilters"),
    getViewer(),
  ]);
  if (viewer.resolvedPermissions["wordFilter.manage"] !== true) notFound();
  return (
    <EditForm action={saveWordFilter} submit={t("create.submit")}>
      <input type="hidden" name="creating" value="1" />
      <FieldGroup legend={t("fields.group")}>
        <FilterFields />
      </FieldGroup>
    </EditForm>
  );
}

export default function NewFilterPage() {
  const t = useTranslations("adminContent.wordFilters");
  return (
    <ScreenFrame
      heading={t("create.heading")}
      subtitle={t("create.description")}
      trail={staffTrail("/admin/word-filters/new")}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <NewFilter />
    </ScreenFrame>
  );
}
