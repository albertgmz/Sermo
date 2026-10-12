// The name of a member as the Markdown renderer reads a mention: plain when it can be, else quoted.
const PLAIN_NAME = /^[\p{L}\p{N}_][\p{L}\p{N}._-]{1,30}[\p{L}\p{N}_]$/u;
export const mentionOf = (username: string) =>
  PLAIN_NAME.test(username) ? `@${username}` : `@"${username}"`;

const ESCAPED = String.raw`\_`;
const PLAIN_MENTION = /(^|[\s(])@((?:[\p{L}\p{N}._-]|\\_)+)/gu;
const QUOTED_MENTION = /@"([^"\n]*)"/g;

// The editor escapes an underscore when it writes Markdown, which the renderer reads as a plain
// "_" and no longer as part of a member's name. Mentions are put back the way they were typed.
export function unescapeMentions(markdown: string) {
  return markdown
    .replace(
      PLAIN_MENTION,
      (_, lead: string, name: string) =>
        `${lead}@${name.replaceAll(ESCAPED, "_")}`,
    )
    .replace(
      QUOTED_MENTION,
      (_, name: string) => `@"${name.replaceAll(ESCAPED, "_")}"`,
    );
}
