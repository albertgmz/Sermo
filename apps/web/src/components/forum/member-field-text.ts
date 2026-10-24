import { useTranslations } from "next-intl";

// The words of a member field, drawn on the server and handed to the client picker.
export function useMemberFieldText() {
  const t = useTranslations("forum.memberField");
  return {
    placeholder: t("placeholder"),
    noMatch: t("noMatch"),
    chosen: t("chosen"),
    remove: t("remove", { name: "{name}" }),
  };
}
