import mjml2html from "mjml";
import { type Language, phrase } from "../i18n";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface TemplateInput {
  language: Language;
  site: string;
  subject: string;
  body: string;
  links?: { label: string; url: string }[];
  unsubscribe?: { typeUrl: string; allUrl: string };
}

export async function renderEmail(
  input: TemplateInput,
): Promise<{ subject: string; html: string; text: string }> {
  const subject = input.subject.replace(/[\r\n]+/g, " ");
  const lines = [input.body];
  for (const link of input.links ?? []) lines.push(`${link.label}: ${link.url}`);
  if (input.unsubscribe) {
    lines.push(`${phrase(input.language, "email.unsubscribe.type")}: ${input.unsubscribe.typeUrl}`);
    lines.push(`${phrase(input.language, "email.unsubscribe.all")}: ${input.unsubscribe.allUrl}`);
  }
  lines.push(phrase(input.language, "email.layout.footer", { site: input.site }));
  const content = [`<mj-text font-size="16px">${escapeXml(input.body)}</mj-text>`];
  for (const link of input.links ?? [])
    content.push(`<mj-button href="${escapeXml(link.url)}">${escapeXml(link.label)}</mj-button>`);
  if (input.unsubscribe)
    content.push(
      `<mj-text font-size="12px"><a href="${escapeXml(input.unsubscribe.typeUrl)}">${escapeXml(phrase(input.language, "email.unsubscribe.type"))}</a><br/><a href="${escapeXml(input.unsubscribe.allUrl)}">${escapeXml(phrase(input.language, "email.unsubscribe.all"))}</a></mj-text>`,
    );
  content.push(
    `<mj-text font-size="12px">${escapeXml(phrase(input.language, "email.layout.footer", { site: input.site }))}</mj-text>`,
  );
  const result = await mjml2html(
    `<mjml><mj-head><mj-title>${escapeXml(subject)}</mj-title></mj-head><mj-body><mj-section><mj-column>${content.join("")}</mj-column></mj-section></mj-body></mjml>`,
    { validationLevel: "strict" },
  );
  if (result.errors.length) throw new Error(result.errors.map((error) => error.message).join("; "));
  return { subject, html: result.html, text: lines.join("\n\n") };
}
