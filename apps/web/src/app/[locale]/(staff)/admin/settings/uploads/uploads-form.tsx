import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { groupsIfAllowed } from "../../groups/data";
import { saveUploads } from "../actions";
import { getSettings } from "../data";
import { NumberRow } from "../fields";
import { Subheading } from "../subheading";

export async function UploadsForm() {
  const [t, purposes, settings, groups] = await Promise.all([
    getTranslations("adminSetup.pages.uploads"),
    getTranslations("adminSetup.purposes"),
    getSettings(),
    groupsIfAllowed(),
  ]);
  // Every group the viewer may list; without that permission, the groups the settings name.
  const rows = groups
    ? groups.map((group) => ({ id: String(group.id), title: group.title }))
    : Object.keys(settings.groupUploadLimitBytes).map((id) => ({
        id,
        title: t("groupFallback", { id }),
      }));
  return (
    <FormRows action={saveUploads} heading={t("formHeading")}>
      <Subheading heading={t("sizeHeading")} />
      <NumberRow name="maxUploadBytes" value={settings.maxUploadBytes} />
      <Subheading
        heading={t("typesHeading")}
        description={t("typesDescription")}
      />
      {Object.entries(settings.allowedUploadTypes).map(([purpose, list]) => (
        <FieldRow
          key={purpose}
          name={`allowedUploadTypes.${purpose}`}
          label={
            purposes.has(purpose as "avatar")
              ? purposes(purpose as "avatar")
              : purpose
          }
          htmlFor={`field-types-${purpose}`}
        >
          <Textarea
            id={`field-types-${purpose}`}
            name={`allowedUploadTypes.${purpose}`}
            rows={Math.max(3, list.length + 1)}
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={list.join("\n")}
          />
        </FieldRow>
      ))}
      <Subheading
        heading={t("groupsHeading")}
        description={t("groupsDescription")}
      />
      {rows.map(({ id, title }) => (
        <FieldRow
          key={id}
          name={`groupUploadLimitBytes.${id}`}
          label={title}
          htmlFor={`field-group-${id}`}
        >
          <div className="flex items-center gap-2">
            <Input
              id={`field-group-${id}`}
              name={`groupUploadLimitBytes.${id}`}
              type="number"
              inputMode="numeric"
              placeholder={t("unlimited")}
              defaultValue={settings.groupUploadLimitBytes[id]}
            />
            <span className="shrink-0 text-sm text-muted-foreground">
              {t("unit")}
            </span>
          </div>
        </FieldRow>
      ))}
    </FormRows>
  );
}
