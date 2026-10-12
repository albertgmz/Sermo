import { getTranslations } from "next-intl/server";
import { FieldRow } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// The rows a page is written with. `page` is what the backend returned for an existing page;
// without it the rows are empty (published by default).
export async function PageFields({
  page,
}: {
  page?: { title: string; bodySource: string; isPublished: boolean };
}) {
  const t = await getTranslations("adminContent.pages.fields");
  return (
    <>
      <FieldRow name="title" label={t("title")} htmlFor="page-title">
        <Input
          id="page-title"
          name="title"
          required
          defaultValue={page?.title}
        />
      </FieldRow>
      <FieldRow
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
      </FieldRow>
      <FieldRow
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
      </FieldRow>
    </>
  );
}
