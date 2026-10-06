/** Plain text stored when the first post is written. */
export function maskMarkupForExcerpt(source: string): string {
  const output: string[] = [];
  const containers: ("quote" | "spoiler")[] = [];
  let fence: string | null = null;
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const text = line.replace(/^\s*(?:(?:>\s*)|(?:(?:[-*+]|\d+\.)\s+))*/, "");
    const marker = /^(`{3,}|~{3,})/.exec(text)?.[1];
    if (marker) {
      if (!fence) fence = marker[0]!;
      else if (marker[0] === fence && marker.length >= 3) fence = null;
    }
    if (!fence && !marker) {
      const open = /^:::(quote|spoiler)(?:\{[^\n}]*\})?\s*$/.exec(text);
      if (open) {
        if (open[1] === "spoiler" && !containers.includes("spoiler")) output.push("[spoiler]");
        containers.push(open[1] as "quote" | "spoiler");
        continue;
      }
      if (/^:::\s*$/.test(text) && containers.length) {
        containers.pop();
        continue;
      }
    }
    if (!containers.includes("spoiler")) output.push(line.replace(/>![^\n]*?!</g, "[spoiler]"));
  }
  return output.join("\n");
}

export function excerptFromMarkdown(source: string, limit = 200): string {
  const text = maskMarkupForExcerpt(source)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
