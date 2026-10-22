// How the page that stands without the layout (`app/global-error.tsx`) is drawn: in the language
// the visitor reads (their language cookie, else their browser's first language) and in the colour
// theme they chose (the stored theme choice: dark, or system following the device; light when they chose
// nothing). Pure, so it is decided from what the browser holds.
export type ErrorLook = { language: "en" | "es"; dark: boolean };

export function errorLook(
  localeCookie: string | undefined,
  browserLanguage: string | undefined,
  themeChoice: string | null,
  deviceIsDark: boolean,
): ErrorLook {
  const language = (localeCookie ?? browserLanguage ?? "").toLowerCase();
  return {
    language: /^es($|[-_])/.test(language) ? "es" : "en",
    dark: themeChoice === "dark" || (themeChoice === "system" && deviceIsDark),
  };
}
