import "server-only";
import { getTranslations } from "next-intl/server";
import { gateEmbeds } from "./embeds";
import { getConsent } from "./server";
import { mayEmbed } from "./state";

// The HTML of a body for this visitor: its players, or placeholders while embeds are not accepted.
// The words are in the visitor's language.
export async function withEmbedGate(html: string): Promise<string> {
  if (!/<iframe/i.test(html)) return html;
  const [consent, t] = await Promise.all([
    getConsent(),
    getTranslations("forum.bbCode"),
  ]);
  return gateEmbeds(html, mayEmbed(consent), {
    hosted: (provider) => t("embedHosted", { provider }),
    load: t("embedLoad"),
    always: t("embedAlways"),
    original: t("embedOriginal"),
  });
}
