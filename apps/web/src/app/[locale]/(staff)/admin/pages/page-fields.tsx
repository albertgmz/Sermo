import { getTranslations } from "next-intl/server";
import { Field } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// The fields a page is written with. `page` is what the backend returned for an existing page;
// without it the fields are empty (published by default). `versioned`: members accept this page
// (the terms and the rules), so saving can publish it as a new version.
export async function PageFields({
  page,
  versioned = false,
}: {
  page?: { title: string; bodySource: string; isPublished: boolean };
  versioned?: boolean;
}) {
  const t = await getTranslations("adminContent.pages.fields");
  return (
    <>
      <Field name="title" label={t("title")} htmlFor="page-title">
        <Input
          id="page-title"
          name="title"
          required
          defaultValue={page?.title}
        />
      </Field>
      <Field
        name="body"
        label={t("body")}
        htmlFor="page-body"
        help={t("bodyHelp")}
      >
        <Textarea
          id="page-body"
          name="body"
          required
          rows={16}
          spellCheck={false}
          defaultValue={page?.bodySource}
          aria-describedby="page-body-help"
          className="font-mono"
        />
      </Field>
      <Field
        name="isPublished"
        label={t("published")}
        htmlFor="page-published"
        help={t("publishedHelp")}
      >
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id="page-published"
            type="checkbox"
            name="isPublished"
            defaultChecked={page?.isPublished ?? true}
            className="size-5"
          />
          {t("publishedSwitch")}
        </label>
      </Field>
      {versioned && page && (
        <Field
          name="newVersion"
          label={t("newVersion")}
          htmlFor="page-new-version"
          help={t("newVersionHelp")}
        >
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id="page-new-version"
              type="checkbox"
              name="newVersion"
              className="size-5"
            />
            {t("newVersionSwitch")}
          </label>
        </Field>
      )}
    </>
  );
}
