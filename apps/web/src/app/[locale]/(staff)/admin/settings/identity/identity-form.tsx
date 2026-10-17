import { getTranslations } from "next-intl/server";
import { Art } from "@/components/forum/art";
import { Logo } from "@/components/layout/logo";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { PictureField } from "@/components/staff/picture-field";
import { getSite } from "@/lib/sermo/site";
import { saveIdentity } from "./actions";
import { PICTURES } from "./pictures";

// The site's logo, icon and backdrop. Each shows what the public site draws now (through the same
// components and LITE gates), uploads a new file at once, and can be removed; saving sends only
// the pictures that were changed. The icon is drawn in a box: the public site only emits it as
// a link in the page head.
export async function IdentityForm() {
  const [t, site] = await Promise.all([
    getTranslations("adminSetup.identity"),
    getSite(),
  ]);
  const current = {
    logoFileId: site.logo && (
      <span className="rounded-lg border bg-background px-3">
        <Logo />
      </span>
    ),
    iconFileId: site.icon && (
      <Art
        src={site.icon.url}
        category="brand"
        className="size-12 rounded-lg border bg-background"
      />
    ),
    backdropFileId: site.backdrop && (
      <div className="relative isolate h-32 w-full overflow-hidden rounded-lg border bg-background">
        <PageBackdrop />
      </div>
    ),
  };
  return (
    <EditForm action={saveIdentity}>
      <FieldGroup legend={t("formHeading")} description={t("formDescription")}>
        {PICTURES.map(({ key, purpose }) => (
          <Field
            key={key}
            name={key}
            label={t(`${key}.label`)}
            htmlFor={`identity-${key}`}
            help={t(`${key}.help`)}
          >
            <PictureField
              purpose={purpose}
              name={key}
              id={`identity-${key}`}
              removable
              current={current[key] || undefined}
            />
          </Field>
        ))}
      </FieldGroup>
    </EditForm>
  );
}
