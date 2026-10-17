import { tagsList } from "@sermo/core/contracts";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Section } from "@/components/staff/rows";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { tagHref } from "@/lib/sermo/tags";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
import { deleteTag, mergeTag, renameTag } from "../actions";

type Props = PageProps<"/[locale]/admin/tags/[id]">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.tags.edit");
  return { title: t("metaTitle") };
}

// The backend lists tags by name only, so the tag is found by the name the list link carries and
// checked against the id in the address: a name that has changed since, or an id that is not the
// tag's, sends the viewer back to the list.
async function EditTag({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const [{ id }, { name }] = await Promise.all([params, searchParams]);
  const tagId = parseId(id);
  // A name the contract would refuse is no tag's name.
  if (tagId === null || (typeof name === "string" && name.length > 120))
    notFound();
  if (typeof name !== "string" || name === "") redirect("/admin/tags");
  const [t, { items }] = await Promise.all([
    getTranslations("adminContent.tags"),
    read(tagsList, { query: name, limit: 1 }),
  ]);
  const tag = items[0];
  if (!tag || tag.id !== tagId || tag.name !== name) redirect("/admin/tags");
  return (
    <>
      <Section heading={t("edit.infoHeading")}>
        <div className="space-y-2 p-4 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="[overflow-wrap:anywhere]">#{tag.name}</span>
            <Badge variant="secondary">
              {t("list.threads", { count: tag.threadCount })}
            </Badge>
          </p>
          {tag.aliases.length > 0 && (
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {t("list.aliases", {
                names: tag.aliases.map((alias) => `#${alias}`).join(", "),
              })}
            </p>
          )}
          <Link
            href={tagHref(tag.name)}
            className="inline-flex min-h-10 items-center gap-1.5 text-primary-ink underline-offset-4 hover:underline"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
            {t("list.view", { name: tag.name })}
          </Link>
        </div>
      </Section>
      <EditForm action={renameTag} submit={t("edit.renameSubmit")}>
        <input type="hidden" name="id" value={tag.id} />
        <FieldGroup
          legend={t("edit.renameHeading")}
          description={t("edit.renameDescription")}
        >
          <Field name="name" label={t("edit.name")} htmlFor="tag-name">
            <Input
              id="tag-name"
              name="name"
              defaultValue={tag.name}
              autoComplete="off"
              autoCapitalize="none"
            />
          </Field>
        </FieldGroup>
      </EditForm>
      <EditForm action={mergeTag} submit={t("edit.mergeSubmit")}>
        <input type="hidden" name="id" value={tag.id} />
        <FieldGroup
          legend={t("edit.mergeHeading")}
          description={t("edit.mergeDescription")}
        >
          <Field
            name="into"
            label={t("edit.into")}
            htmlFor="tag-into"
            help={t("edit.intoHelp")}
          >
            <Input
              id="tag-into"
              name="into"
              autoComplete="off"
              autoCapitalize="none"
              aria-describedby="tag-into-help"
            />
          </Field>
        </FieldGroup>
      </EditForm>
      <ConfirmStep
        heading={t("edit.deleteHeading")}
        action={deleteTag}
        fields={{ id: String(tag.id) }}
        summary={t("list.delete")}
        warning={t("list.deleteWarning", { count: tag.threadCount })}
        submit={t("list.delete")}
      />
    </>
  );
}

export default function EditTagPage({ params, searchParams }: Props) {
  const t = useTranslations("adminContent.tags");
  return (
    <ScreenFrame
      heading={t("edit.heading")}
      subtitle={t("edit.description")}
      trail={params.then(({ id }) => staffTrail(`/admin/tags/${id}`))}
      label={t("loading")}
      fallback={<FormSkeleton rows={2} />}
    >
      <EditTag params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
