import { expect, test } from "bun:test";
import { type Brand, DEFAULT_ACCENT, renderEmail } from "./template";

/** WCAG contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const brand: Brand = {
  name: "Sermo",
  url: "https://forum.example.test",
  logoUrl: "https://files.example.test/api/v1/files/1",
  iconUrl: "https://files.example.test/api/v1/files/2",
  accent: "#2563eb",
  accentForeground: "#ffffff",
  contactUrl: null,
  preferencesUrl: "https://forum.example.test/account/notifications",
};
const unsubscribe = {
  typeUrl: "https://forum.example.test/api/v1/unsubscribe?token=type",
  allUrl: "https://forum.example.test/api/v1/unsubscribe?token=all",
};
const OUTLOOK_ONLY = /<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/g;

const render = (picked: Brand) =>
  renderEmail({ language: "en", brand: picked, reason: "account", subject: "Hi", body: "Body" });

test("the site's name and addresses are escaped wherever they appear", async () => {
  const hostile = {
    ...brand,
    name: '<b onclick="x">Club</b> & "friends"',
    logoUrl: 'https://files.example.test/1"><script>alert(1)</script>',
    iconUrl: "https://files.example.test/2'><svg onload=alert(2)>",
    url: 'https://forum.example.test/"><script>alert(3)</script>',
  };
  const rendered = await render(hostile);
  for (const raw of ["<b onclick", "<script>", "<svg", '1"><', "2'><"])
    expect(rendered.html).not.toContain(raw);
  expect(rendered.html).toContain(
    "&lt;b onclick=&quot;x&quot;&gt;Club&lt;/b&gt; &amp; &quot;friends&quot;",
  );
  expect(rendered.html).toContain("1&quot;&gt;&lt;script&gt;");
  expect(rendered.text).toContain(hostile.name);
});

test("the header shows the logo, else the icon beside the name, else the name, linking home", async () => {
  const withLogo = (await render(brand)).html;
  const others = withLogo.replace(OUTLOOK_ONLY, "");
  const outlook = [...withLogo.matchAll(OUTLOOK_ONLY)].map((match) => match[1]).join("");
  expect(others).toContain(
    `<a href="${brand.url}" style="text-decoration:none"><img src="${brand.logoUrl}" alt="Sermo"`,
  );
  // Only maximums, so a very wide logo scales down whole instead of being squashed.
  const logoTag = others.match(/<img src="[^"]*files\/1"[^>]*>/)![0];
  expect(logoTag).toContain("width:auto;height:auto;max-width:100%;max-height:40px");
  expect(logoTag).not.toMatch(/ height="|[;"]height:\d/);
  expect(others).not.toContain(brand.iconUrl!);
  // Classic Outlook cannot show the WebP logo: it gets the PNG icon and the name.
  expect(outlook).toContain(`<img src="${brand.iconUrl}"`);
  expect(outlook).toContain(">Sermo</span>");
  expect(outlook).not.toContain(brand.logoUrl!);

  const iconOnly = (await render({ ...brand, logoUrl: null })).html;
  expect(iconOnly).not.toContain("<!--[if mso]><a");
  expect(iconOnly).toContain(`<img src="${brand.iconUrl}"`);
  expect(iconOnly).toContain(">Sermo</span>");

  const nameOnly = (await render({ ...brand, logoUrl: null, iconUrl: null })).html;
  expect(nameOnly).not.toContain("files.example.test");
  expect(nameOnly).toContain(
    `<a href="${brand.url}" style="text-decoration:none;color:#18181b"><span`,
  );
});

test("a button takes the accent, its address is shown as text, and the text part keeps everything", async () => {
  const rendered = await renderEmail({
    language: "es",
    brand: { ...brand, contactUrl: "https://forum.example.test/contact" },
    reason: "notification",
    unsubscribe,
    subject: "Asunto",
    body: "Primera línea.\nSegunda línea.\n\nOtro párrafo.",
    links: [{ label: "Abrir", url: "https://forum.example.test/threads/1?a=1&b=2" }],
  });
  expect(rendered.html).toContain('lang="es"');
  expect(rendered.html).toContain('bgcolor="#2563eb"');
  expect(rendered.html).toContain("background:#2563eb;color:#ffffff");
  expect(rendered.html).toContain(">https://forum.example.test/threads/1?a=1&amp;b=2</a>");
  expect(rendered.html).toContain("Primera línea.<br/>Segunda línea.</p><p");
  // The hidden preheader is the body's first line.
  expect(rendered.html).toMatch(/<div style="display:none[^>]*>Primera línea\.&#847;&zwnj;&nbsp;/);
  expect(rendered.html).not.toContain("fonts.googleapis.com");
  expect(rendered.html).toContain("prefers-color-scheme: dark");
  expect(rendered.html).toContain('<meta name="color-scheme" content="light dark"');
  for (const part of [
    "Sermo\n\nAsunto",
    "Primera línea.\nSegunda línea.\n\nOtro párrafo.",
    "Abrir: https://forum.example.test/threads/1?a=1&b=2",
    "Recibes este correo porque tienes activadas las notificaciones por correo en Sermo.",
    `Dejar de recibir correos como este: ${unsubscribe.typeUrl}`,
    `Dejar de recibir todos los correos de notificaciones: ${unsubscribe.allUrl}`,
    "Inicio: https://forum.example.test",
    "Contacto: https://forum.example.test/contact",
    `Configurar notificaciones: ${brand.preferencesUrl}`,
  ])
    expect(rendered.text).toContain(part);
});

test("account mail has no unsubscribe or notification links and says why it was sent", async () => {
  const rendered = await render(brand);
  for (const part of [rendered.html, rendered.text]) {
    expect(part).not.toContain("unsubscribe");
    expect(part).not.toContain("Stop ");
    expect(part).not.toContain(brand.preferencesUrl);
    expect(part).toContain("You received this email because it concerns your account at Sermo.");
  }
});

test("a pale accent is darkened for link text and keeps its own colours on the button", async () => {
  const rendered = await renderEmail({
    language: "en",
    brand: { ...brand, accent: "#facc15", accentForeground: "#1c1304" },
    reason: "account",
    subject: "Verify",
    body: "Verify your address.",
    links: [{ label: "Verify", url: "https://forum.example.test/verify" }],
  });
  expect(rendered.html).toContain("background:#facc15;color:#1c1304");
  const light = rendered.html.match(/class="sermo-link" href="[^"]*" style="color:(#[0-9a-f]{6})/);
  const dark = rendered.html.match(/\.sermo-link \{ color: (#[0-9a-f]{6}) !important/);
  expect(contrast(light![1]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(contrast(dark![1]!, "#18181b")).toBeGreaterThanOrEqual(4.5);
});

test("an accent that is not #rrggbb gives way to Sermo's, and a bad foreground to black or white", async () => {
  const button = async (accent: string, accentForeground: string) =>
    (
      await renderEmail({
        language: "en",
        brand: { ...brand, accent, accentForeground },
        reason: "account",
        subject: "Verify",
        body: "Verify.",
        links: [{ label: "Verify", url: "https://forum.example.test/verify" }],
      })
    ).html;
  const hostile = await button('red;}</style><script>x</script>"', "#000000");
  expect(hostile).not.toContain("red;");
  expect(hostile).toContain(
    `background:${DEFAULT_ACCENT.color};color:${DEFAULT_ACCENT.foreground}`,
  );
  expect(await button("#facc15", "black;x")).toContain("background:#facc15;color:#000000");
  expect(await button("#1e3a8a", "")).toContain("background:#1e3a8a;color:#ffffff");
});

test("the dark palette's classes sit where its selectors look, and never on the button", async () => {
  const html = (
    await renderEmail({
      language: "en",
      brand,
      reason: "account",
      subject: "Verify",
      body: "Verify.",
      links: [{ label: "Verify", url: "https://forum.example.test/verify" }],
    })
  ).html;
  expect(html).toMatch(/<body\s+class="sermo-page"/);
  expect(html).toMatch(/<div\s+class="sermo-card" style="background:#ffffff/);
  expect(html).toMatch(/<td\s+align="left" class="sermo-heading"/);
  expect(html).toMatch(/<td\s+align="left" class="sermo-muted"/);
  expect(html).toMatch(/<div\s+class="sermo-footer"/);
  // The button is a table cell and a link, with no div or paragraph the card's rules recolour.
  const buttonCell = html.slice(
    html.indexOf('bgcolor="#2563eb"'),
    html.indexOf("</a>", html.indexOf('bgcolor="#2563eb"')),
  );
  expect(buttonCell).not.toMatch(/<div|<p[ >]|class="sermo/);
});

test("the digest's threads are a list of linked titles with their detail", async () => {
  const rendered = await renderEmail({
    language: "en",
    brand,
    reason: "digest",
    unsubscribe,
    subject: "Digest",
    body: "2 active discussions since your last visit.",
    items: [
      { label: "First <thread>", detail: "1 reply", url: "https://forum.example.test/threads/1" },
      { label: "Second", detail: "2 replies", url: "https://forum.example.test/threads/2" },
    ],
  });
  expect(rendered.html).not.toContain(`bgcolor="${brand.accent}"`);
  expect(rendered.html).toContain(">First &lt;thread&gt;</a>");
  expect(rendered.html).toContain(">2 replies</span>");
  expect(rendered.text).toContain("First <thread>\n1 reply\nhttps://forum.example.test/threads/1");
  expect(rendered.text).toContain("because digests are on for your account at Sermo");
  expect(rendered.text).toContain(`Notification settings: ${brand.preferencesUrl}`);
});
