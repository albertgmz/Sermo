import { useTranslations } from "next-intl";
import { SkipLinkAnchor } from "@/components/layout/skip-link-anchor";

// The id of the frame's `<main>`, which takes `tabIndex={-1}` so that following the link moves the
// focus into it and not only the scroll.
export const MAIN_ID = "main-content";

// The first stop of the keyboard in every frame that has a header: a way past it to the page.
export function SkipLink() {
  const t = useTranslations("layout.skipLink");
  return <SkipLinkAnchor target={MAIN_ID}>{t("label")}</SkipLinkAnchor>;
}
