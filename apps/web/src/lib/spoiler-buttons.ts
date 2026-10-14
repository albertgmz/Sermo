// A body holds one empty placeholder per spoiler (its position, and its title when it has one).
// Each becomes a button the visitor presses to read the spoiler; its label comes from CSS, in the
// visitor's language. Without a content to ask for, the button is disabled.
const PLACEHOLDER =
  /<(div|span) class="bb-spoiler( bb-spoiler-inline)?" data-spoiler="(\d{1,3})"(?: data-spoiler-title="([^"]*)")?><\/\1>/g;

export function withSpoilerButtons(html: string, enabled: boolean): string {
  if (!html.includes("data-spoiler=")) return html;
  return html.replace(
    PLACEHOLDER,
    (
      _,
      tag: string,
      inline: string | undefined,
      position: string,
      title?: string,
    ) =>
      `<${tag} class="bb-spoiler${inline ?? ""}" data-spoiler="${position}">` +
      `<button type="button" class="bb-spoiler-button" data-spoiler-button aria-expanded="false"${enabled ? "" : " disabled"}>` +
      // The title is already escaped for an attribute, which is valid as text too.
      `${title ? `<span class="bb-spoiler-title">${title}</span>` : ""}</button></${tag}>`,
  );
}
