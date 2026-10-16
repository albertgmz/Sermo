import { getTranslations } from "next-intl/server";
import { refusalIn } from "@/app/[locale]/(auth)/native-form";

// What a page tells a visitor whose form was refused while it was sent without the page's script
// (see `native-form.ts`), or nothing when the address names no refusal.
export async function refusalText(value: string | string[] | undefined) {
  const key = refusalIn(value);
  if (!key) return undefined;
  const t = await getTranslations("auth.actions.errors");
  return t(key);
}
