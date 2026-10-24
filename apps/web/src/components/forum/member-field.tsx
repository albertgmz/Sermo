import { useTranslations } from "next-intl";
import { LazyMemberPickerField } from "@/components/forum/lazy-member-picker-field";
import { MemberPickerField } from "@/components/forum/member-picker-field";

// The one member filter of the search forms (the page's and the header popup's): a labelled box
// that suggests members as the visitor types and keeps the chosen one as a chip. `lazy` is for a
// popup, whose picker code loads when the popup draws it.
export function MemberField({
  name,
  label,
  initial,
  lazy = false,
}: {
  name: string;
  label: string;
  initial?: string;
  lazy?: boolean;
}) {
  const t = useTranslations("forum.memberField");
  const Field = lazy ? LazyMemberPickerField : MemberPickerField;
  return (
    <Field
      name={name}
      label={label}
      initial={initial}
      text={{
        placeholder: t("placeholder"),
        noMatch: t("noMatch"),
        chosen: t("chosen"),
        remove: t("remove", { name: "{name}" }),
      }}
    />
  );
}
