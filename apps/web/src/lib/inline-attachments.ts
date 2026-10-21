import { getLocale, getTranslations } from "next-intl/server";
import { placeAttachments, type TaggedAttachment } from "@/lib/attachment-tags";
import { liteBlocks } from "@/lib/lite-mode";

// Puts the item's attachments where the body's `[ATTACH]` tags are, in the visitor's language and
// through the same LITE gate as the list under the body. The body and every spoiler opened out of
// it go through here, so a tag looks the same in both.
export async function placeInlineAttachments(
  html: string,
  attachments: readonly TaggedAttachment[],
): Promise<string> {
  if (!html.includes("bb-attach")) return html;
  const [locale, lite, liteImages, bbCode] = await Promise.all([
    getLocale(),
    getTranslations("lite.litePlaceholder"),
    liteBlocks("postImages"),
    getTranslations("forum.bbCode"),
  ]);
  return placeAttachments(html, attachments, {
    locale,
    liteImages,
    liteLabel: lite("label"),
    liteAria: lite("aria.label"),
    missingLabel: bbCode("attachment"),
  });
}
