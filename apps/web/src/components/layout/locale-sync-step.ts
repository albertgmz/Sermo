// What a member's saved language asks of this browser. Nothing when they chose none, when the
// page is already in it, or when the cookie already says so (the guard against a refresh loop: a
// browser that drops the cookie shows the page in its own language, and asks once). Otherwise the
// cookie is set to it and the page is read again.
export function localeSync(input: {
  language: string | null;
  active: string;
  cookie: string | undefined;
}): { set: string; refresh: true } | null {
  const { language, active, cookie } = input;
  if (!language || language === active || language === cookie) return null;
  return { set: language, refresh: true };
}
