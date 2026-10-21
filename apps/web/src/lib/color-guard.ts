// A colour typed in a post is stored as `<span style="color:#ff0000">`, which no theme can hold
// against its page (white on the light one, black on the dark one). Each such span becomes
// `<span class="bb-color" style="--ink:#ff0000">`, which `globals.css` draws with its lightness
// held between the bounds of the accent's ink in the visitor's theme, hue and chroma kept. The
// pattern is the one the backend's sanitizer lets through (a 3 or 6 digit hex or a colour name).
const COLOR_SPAN =
  /<span style="color:\s*(#(?:[0-9a-f]{3}){1,2}|[a-z]{3,12});?">/gi;

export function withColorGuard(html: string): string {
  if (!html.includes("color:")) return html;
  return html.replace(
    COLOR_SPAN,
    (_, color: string) => `<span class="bb-color" style="--ink:${color}">`,
  );
}
