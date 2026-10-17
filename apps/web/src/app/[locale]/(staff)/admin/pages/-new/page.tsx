import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { Input } from "@/components/ui/input";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { createPage } from "../actions";
import { PageFields } from "../page-fields";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.pages.create");
  return { title: t("metaTitle") };
}

// The slug a suggestion offered, in the address.
async function NewPage({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/pages/-new">["searchParams"];
}) {
  const [t, query] = await Promise.all([
    getTranslations("adminContent.pages"),
    searchParams,
  ]);
  const suggested = typeof query.slug === "string" ? query.slug : "";
  return (
    <EditForm key={suggested} action={createPage} submit={t("create.submit")}>
      <FieldGroup legend={t("fields.group")}>
        <Field
          name="slug"
          label={t("create.slug")}
          htmlFor="page-slug"
          help={t("create.slugHelp")}
        >
          <Input
            id="page-slug"
            name="slug"
            required
            defaultValue={suggested}
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="page-slug-help"
          />
        </Field>
        <PageFields />
      </FieldGroup>
    </EditForm>
  );
}

export default function NewPagePage({
  searchParams,
}: PageProps<"/[locale]/admin/pages/-new">) {
  const t = useTranslations("adminContent.pages");
  return (
    <ScreenFrame
      heading={t("create.heading")}
      subtitle={t("create.description")}
      trail={staffTrail("/admin/pages/-new")}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <NewPage searchParams={searchParams} />
    </ScreenFrame>
  );
}
