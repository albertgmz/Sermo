import { getLocale, getTranslations } from "next-intl/server";
import "@/components/forum/member-card-parts";
import { MentionCards } from "@/components/forum/mention-cards";
import { prose } from "@/components/forum/prose";
import {
  type SpoilerContent,
  SpoilerReveal,
} from "@/components/forum/spoiler-reveal";
import { placeAttachments, type TaggedAttachment } from "@/lib/attachment-tags";
import { withEmbedGate } from "@/lib/consent/embed-gate";
import { stripHtmlMedia } from "@/lib/lite-content";
import {
  getLiteLabel,
  getLiteOrigin,
  getLiteState,
  liteBlocks,
} from "@/lib/lite-mode";
import { withSpoilerButtons } from "@/lib/spoiler-buttons";
import { cn } from "@/lib/utils";

// The look of the editor's text (`prose`), for the elements of the HTML the backend stored. Each
// rule repeats a class of `prose` on the elements below the root. What BB code adds (alignment, code blocks,
// spoilers, tables, highlighting) is styled in `globals.css` under `.bb-content`.
const elements = cn(
  "[&_h1]:text-xl [&_h1]:leading-snug [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:text-lg [&_h2]:leading-snug [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_:is(h3,h4,h5,h6)]:text-base [&_:is(h3,h4,h5,h6)]:leading-snug [&_:is(h3,h4,h5,h6)]:font-semibold",
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ul]:marker:text-muted-foreground",
  "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ol]:marker:text-muted-foreground",
  "[&_li]:pl-0.5",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_a]:font-medium [&_a]:text-primary-ink [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:no-underline",
  "[&_strong]:font-semibold [&_em]:italic [&_del]:text-muted-foreground [&_del]:line-through",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:block [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-(length:--text-compact) [&_pre]:leading-relaxed [&_pre]:whitespace-pre",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:border-border",
  "[&_img]:h-auto [&_img]:max-w-full",
);

// Renders HTML the backend produced and sanitised; the text is not parsed or changed here. LITE
// mode removes its pictures on the server first. A mention in it shows the member's card on hover.
// The words BB code shows (a code block's header, "said:", "Spoiler") are not in the HTML: they are
// CSS variables set here in the visitor's language. A body with spoilers needs the `content` it
// belongs to, to ask for them; without it their buttons are disabled. The `attachments` of the item
// take the place of its `[ATTACH]` tags, drawn through the same LITE gate as the list under the body.
export async function HtmlContent(props: {
  children: string;
  className?: string;
  content?: SpoilerContent;
  attachments?: TaggedAttachment[];
}) {
  const [state, origin, label, t] = await Promise.all([
    getLiteState(),
    getLiteOrigin(),
    getLiteLabel(),
    getTranslations("forum.bbCode"),
  ]);
  let html = withSpoilerButtons(
    await withEmbedGate(stripHtmlMedia(props.children, state, origin, label)),
    props.content !== undefined,
  );
  if (html.includes("bb-attach")) {
    const [locale, lite, liteImages] = await Promise.all([
      getLocale(),
      getTranslations("lite.litePlaceholder"),
      liteBlocks("postImages"),
    ]);
    html = placeAttachments(html, props.attachments ?? [], {
      locale,
      liteImages,
      liteLabel: lite("label"),
      liteAria: lite("aria.label"),
      missingLabel: t("attachment"),
    });
  }
  const body = (
    <div
      className={cn("bb-content", prose.root, elements, props.className)}
      style={
        {
          "--bb-code-label": JSON.stringify(t("codeLabel")),
          "--bb-code-rich-label": JSON.stringify(t("richCodeLabel")),
          "--bb-said": JSON.stringify(t("said")),
          "--bb-spoiler": JSON.stringify(t("spoiler")),
        } as React.CSSProperties
      }
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the backend sanitises this HTML when the page is saved.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
  return (
    <MentionCards>
      {props.content ? (
        <SpoilerReveal content={props.content}>{body}</SpoilerReveal>
      ) : (
        body
      )}
    </MentionCards>
  );
}
