import { parseId } from "@/lib/sermo/ids";

// A thread named by what a moderator pastes: its id, or its address (the slug after the id is
// only decoration).
export function parseThreadRef(text: string): number | null {
  const value = text.trim();
  const plain = parseId(value);
  if (plain !== null) return plain;
  const path = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(value)?.[1] ?? value;
  const match = /^\/threads\/(\d+)(?:-[^/]*)?\/?$/.exec(path);
  return match ? parseId(match[1]) : null;
}
