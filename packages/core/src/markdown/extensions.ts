import { convert } from "html-to-text";
import type { TokenizerAndRendererExtension } from "marked";
import { ValidationError } from "../errors";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

const opening = /^:::(quote|spoiler)(?:\{([^\n}]*)\})?[ \t]*(?:\n|$)/;
const closing = /^:::[ \t]*(?:\n|$)/;
const containerLine =
  /(^|\n):::(?:quote\{post=[1-9]\d*(?: author="[^"\n}]*")?\}|spoiler(?:\{(?:title="[^"\n}]*")?\})?)[ \t]*(?=\n|$)/m;
const inlineSpoilerLine = /(^|\n)>![^\n]+!<[ \t]*(?=\n|$)/m;

function entityText(value: string): string {
  if (!value.includes("&")) return value;
  return convert(value.replace(/</g, "&lt;").replace(/>/g, "&gt;"), { wordwrap: false });
}

export const containerExtension: TokenizerAndRendererExtension = {
  name: "sermoContainer",
  level: "block",
  start(source) {
    const match = containerLine.exec(source);
    return match ? match.index + match[1]!.length : -1;
  },
  tokenizer(source) {
    const open = opening.exec(source);
    if (!open) return;
    const kind = open[1]!;
    const attributes = open[2] ?? "";
    const quote =
      kind === "quote" ? /^post=([1-9]\d*)(?: author="([^"\n]*)")?$/.exec(attributes) : null;
    const spoiler = kind === "spoiler" ? /^(?:title="([^"\n]*)")?$/.exec(attributes) : null;
    if ((kind === "quote" && !quote) || (kind === "spoiler" && !spoiler)) return;

    let offset = open[0].length;
    let depth = 1;
    let fence: { marker: string; length: number } | null = null;
    while (offset < source.length) {
      const next = source.indexOf("\n", offset);
      const end = next < 0 ? source.length : next + 1;
      const line = source.slice(offset, end);
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (
          fenceMatch &&
          fenceMatch[1]![0] === fence.marker &&
          fenceMatch[1]!.length >= fence.length &&
          /^\s*$/.test(line.slice(fenceMatch[0].length))
        )
          fence = null;
      } else if (fenceMatch) {
        fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      } else if (opening.test(line)) {
        depth++;
        if (depth > 10)
          throw new ValidationError("Containers are nested too deeply.", [
            { path: ["body"], message: "Containers may be nested at most 10 levels deep." },
          ]);
      } else if (closing.test(line)) {
        depth--;
        if (depth === 0) {
          const body = source.slice(open[0].length, offset);
          return {
            type: "sermoContainer",
            raw: source.slice(0, end),
            kind,
            postId: quote ? Number(quote[1]) : null,
            author: quote?.[2] ?? null,
            title: entityText(spoiler?.[1] || "Spoiler"),
            openRaw: open[0],
            bodyRaw: body,
            tokens: this.lexer.blockTokens(body),
          };
        }
      }
      offset = end;
    }
  },
  renderer(token) {
    const body = this.parser.parse(token.tokens ?? []);
    if (token.kind === "spoiler") {
      const title = token.title === "Spoiler" ? "Spoiler" : `Spoiler: ${escapeHtml(token.title)}`;
      return `<details class="spoiler"><summary>${title}</summary>${body}</details>`;
    }
    if (token.resolvedAuthor && token.postId) {
      return `<blockquote class="quote" data-post-id="${token.postId}"><cite><a href="/posts/${token.postId}">${escapeHtml(token.resolvedAuthor)}</a> wrote:</cite>${body}</blockquote>`;
    }
    return `<blockquote>${body}</blockquote>`;
  },
};

export const inlineSpoilerExtension: TokenizerAndRendererExtension = {
  name: "sermoInlineSpoiler",
  level: "inline",
  start(source) {
    let at = source.indexOf(">!");
    while (at >= 0) {
      const close = source.indexOf("!<", at + 2);
      const newline = source.indexOf("\n", at);
      if (close >= 0 && (newline < 0 || close < newline)) return at;
      at = newline < 0 ? -1 : source.indexOf(">!", newline + 1);
    }
    return -1;
  },
  tokenizer(source) {
    const match = /^>!([^\n]+?)!</.exec(source);
    if (!match) return;
    return {
      type: "sermoInlineSpoiler",
      raw: match[0],
      tokens: this.lexer.inlineTokens(match[1]!),
    };
  },
  renderer(token) {
    return `<span class="spoiler">${this.parser.parseInline(token.tokens ?? [])}</span>`;
  },
};

/** A leading >! is otherwise claimed by Markdown's blockquote tokenizer. */
export const inlineSpoilerLineExtension: TokenizerAndRendererExtension = {
  name: "sermoInlineSpoilerLine",
  level: "block",
  start(source) {
    const match = inlineSpoilerLine.exec(source);
    return match ? match.index + match[1]!.length : -1;
  },
  tokenizer(source) {
    if (!/^>![^\n]+!<[ \t]*(?:\n|$)/.test(source)) return;
    const line = /^[^\n]*(?:\n|$)/.exec(source)![0];
    return {
      type: "sermoInlineSpoilerLine",
      raw: line,
      tokens: this.lexer.inlineTokens(line.trimEnd()),
    };
  },
  renderer(token) {
    return `<p>${this.parser.parseInline(token.tokens ?? [])}</p>\n`;
  },
};

export const mentionExtension: TokenizerAndRendererExtension = {
  name: "sermoMention",
  level: "inline",
  start(source) {
    const match = /(^|[\s\p{P}])@/u.exec(source);
    return match ? match.index + match[1]!.length : -1;
  },
  tokenizer(source) {
    const match =
      /^@(?:"([\p{L}\p{N}_][\p{L}\p{N} ._-]{1,30}[\p{L}\p{N}_])"|([\p{L}\p{N}_][\p{L}\p{N}._-]{1,30}[\p{L}\p{N}_]))(?![\p{L}\p{N}_-])/u.exec(
        source,
      );
    if (!match) return;
    return { type: "sermoMention", raw: match[0], name: match[1] ?? match[2] };
  },
  renderer(token) {
    if (token.userId && !token.blocked) {
      return `<a href="/members/${token.userId}" class="mention" data-user-id="${token.userId}">@${escapeHtml(token.displayName)}</a>`;
    }
    return escapeHtml(token.raw);
  },
};
