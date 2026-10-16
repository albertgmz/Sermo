// Run by `lhci collect` (collect.puppeteerScript, see lighthouserc.cjs) before Lighthouse loads a
// page: puts the cookies named in LIGHTHOUSE_COOKIES into the cookie jar of the browser Lighthouse
// drives, so the page sees them in `document.cookie` as a returning visitor's. The cookies come
// in the environment of this one run (never a file), as { host, https, cookies: [...] }; a run with
// none (a visitor who has chosen nothing) sets nothing. The script is always set, so every run
// starts Chrome the same way.
module.exports = async (browser) => {
  if (!process.env.LIGHTHOUSE_COOKIES) return;
  const { host, https, cookies } = JSON.parse(process.env.LIGHTHOUSE_COOKIES);
  await browser.setCookie(
    ...cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: host,
      path: "/",
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      sourceScheme: https ? "Secure" : "NonSecure",
    })),
  );
};
