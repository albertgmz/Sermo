import { getTranslations } from "next-intl/server";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveProfile } from "./actions";

type Current = {
  about: string;
  location: string;
  website: string;
  customTitle: string | null;
} | null;

// The profile text of a member. The title and the signature cannot be read back by an
// administrator (the title shows only while the member may show one, the signature only as
// rendered HTML), so they are fields that replace the stored value: empty leaves it alone.
// The +18 mark is shown while the site's +18 mode is on (`adult` not undefined): true or false as
// the profile has it, null when that could not be read, so only a ticked box is sent.
export async function ProfileForm({
  userId,
  current,
  readOnly,
  adult,
}: {
  userId: number;
  current: Current;
  readOnly: boolean;
  adult?: boolean | null;
}) {
  const t = await getTranslations("adminUsers.profile");
  return (
    <EditForm
      key={JSON.stringify(current)}
      action={saveProfile}
      disabled={readOnly}
    >
      <input type="hidden" name="id" value={userId} />
      {current && <input type="hidden" name="known" value="1" />}
      {current && (
        <>
          <input type="hidden" name="was:about" value={current.about} />
          <input type="hidden" name="was:location" value={current.location} />
          <input type="hidden" name="was:website" value={current.website} />
        </>
      )}
      <FieldGroup
        legend={t("heading")}
        description={current ? undefined : t("unreadable")}
      >
        <Field name="about" label={t("about")} htmlFor="profile-about">
          <Textarea
            id="profile-about"
            name="about"
            rows={5}
            defaultValue={current?.about}
          />
        </Field>
        <Field name="location" label={t("location")} htmlFor="profile-location">
          <Input
            id="profile-location"
            name="location"
            defaultValue={current?.location}
          />
        </Field>
        <Field name="website" label={t("website")} htmlFor="profile-website">
          <Input
            id="profile-website"
            name="website"
            defaultValue={current?.website}
          />
        </Field>
        <Field
          name="customTitle"
          label={t("customTitle")}
          htmlFor="profile-title"
          help={
            current?.customTitle
              ? t("customTitleShown", { title: current.customTitle })
              : t("replaceHelp")
          }
        >
          <Input
            id="profile-title"
            name="customTitle"
            placeholder={t("replacePlaceholder")}
          />
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="clear-customTitle"
              className="size-5"
            />
            {t("clear")}
          </label>
        </Field>
        <Field
          name="signature"
          label={t("signature")}
          htmlFor="profile-signature"
          help={t("signatureHelp")}
        >
          <Textarea
            id="profile-signature"
            name="signature"
            rows={3}
            placeholder={t("replacePlaceholder")}
          />
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" name="clear-signature" className="size-5" />
            {t("clear")}
          </label>
        </Field>
        {adult !== undefined && (
          <Field name="isAdult" label={t("adult")} help={t("adultHelp")}>
            <input type="hidden" name="adultShown" value="1" />
            {adult !== null && (
              <input type="hidden" name="was:isAdult" value={String(adult)} />
            )}
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="isAdult"
                defaultChecked={adult === true}
                className="size-5"
              />
              {t("adultSwitch")}
            </label>
          </Field>
        )}
        <Field name="reason" label={t("reason")} htmlFor="profile-reason">
          <Input id="profile-reason" name="reason" />
        </Field>
      </FieldGroup>
    </EditForm>
  );
}
