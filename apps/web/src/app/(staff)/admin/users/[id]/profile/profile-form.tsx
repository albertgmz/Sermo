import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
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
export async function ProfileForm({
  userId,
  current,
  readOnly,
}: {
  userId: number;
  current: Current;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.profile");
  return (
    <FormRows
      key={JSON.stringify(current)}
      action={saveProfile}
      heading={t("heading")}
      description={current ? undefined : t("unreadable")}
      disabled={readOnly}
    >
      <input type="hidden" name="id" value={userId} />
      {current && <input type="hidden" name="known" value="1" />}
      <FieldRow name="about" label={t("about")} htmlFor="profile-about">
        <Textarea
          id="profile-about"
          name="about"
          rows={5}
          maxLength={5000}
          defaultValue={current?.about}
        />
      </FieldRow>
      <FieldRow
        name="location"
        label={t("location")}
        htmlFor="profile-location"
      >
        <Input
          id="profile-location"
          name="location"
          maxLength={100}
          defaultValue={current?.location}
        />
      </FieldRow>
      <FieldRow name="website" label={t("website")} htmlFor="profile-website">
        <Input
          id="profile-website"
          name="website"
          maxLength={200}
          defaultValue={current?.website}
        />
      </FieldRow>
      <FieldRow
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
          maxLength={100}
          placeholder={t("replacePlaceholder")}
        />
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" name="clear-customTitle" className="size-5" />
          {t("clear")}
        </label>
      </FieldRow>
      <FieldRow
        name="signature"
        label={t("signature")}
        htmlFor="profile-signature"
        help={t("signatureHelp")}
      >
        <Textarea
          id="profile-signature"
          name="signature"
          rows={3}
          maxLength={2000}
          placeholder={t("replacePlaceholder")}
        />
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" name="clear-signature" className="size-5" />
          {t("clear")}
        </label>
      </FieldRow>
      <FieldRow name="reason" label={t("reason")} htmlFor="profile-reason">
        <Input id="profile-reason" name="reason" maxLength={1000} />
      </FieldRow>
    </FormRows>
  );
}
