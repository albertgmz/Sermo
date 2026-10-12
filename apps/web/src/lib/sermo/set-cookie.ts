export type ParsedCookie = {
  name: string;
  value: string;
  options: {
    path?: string;
    domain?: string;
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
};

// Parses one Set-Cookie header value. Callers get the values from `getSetCookie()`, so an
// `Expires` date with its comma arrives in one piece.
export function parseSetCookie(header: string): ParsedCookie | null {
  const [pair, ...attributes] = header.split(";");
  const equals = pair.indexOf("=");
  if (equals < 1) return null;
  const name = pair.slice(0, equals).trim();
  const raw = pair.slice(equals + 1).trim();
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {}
  const options: ParsedCookie["options"] = {};
  for (const attribute of attributes) {
    const at = attribute.indexOf("=");
    const key = (at < 0 ? attribute : attribute.slice(0, at))
      .trim()
      .toLowerCase();
    const setting = at < 0 ? "" : attribute.slice(at + 1).trim();
    if (key === "path") options.path = setting;
    else if (key === "domain") options.domain = setting;
    else if (key === "max-age") {
      const seconds = Number(setting);
      if (Number.isInteger(seconds)) options.maxAge = seconds;
    } else if (key === "expires") {
      const date = new Date(setting);
      if (!Number.isNaN(date.getTime())) options.expires = date;
    } else if (key === "httponly") options.httpOnly = true;
    else if (key === "secure") options.secure = true;
    else if (key === "samesite") {
      const mode = setting.toLowerCase();
      if (mode === "lax" || mode === "strict" || mode === "none") {
        options.sameSite = mode;
      }
    }
  }
  return { name, value, options };
}
