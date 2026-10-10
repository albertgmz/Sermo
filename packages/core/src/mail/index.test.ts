import { expect, test } from "bun:test";
import { SMTPServer } from "smtp-server";
import { isLoopbackHost, smtpMailer } from "./index";
import { renderEmail } from "./template";

test("template escapes hostile text and removes header newlines", async () => {
  const rendered = await renderEmail({
    language: "en",
    site: "Sermo",
    subject: "Hello\r\nBcc: attacker@example.test",
    body: '<img src=x onerror="alert(1)">',
  });
  expect(rendered.subject).toBe("Hello Bcc: attacker@example.test");
  expect(rendered.html).not.toContain('<img src=x onerror="alert(1)">');
  expect(rendered.html).toContain("&lt;img");
});

test("SMTP driver sends both parts and custom headers to an in-process server", async () => {
  let raw = "";
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      stream.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      stream.on("end", () => callback());
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let driver: ReturnType<typeof smtpMailer> | undefined;
  try {
    const address = server.server.address();
    if (!address || typeof address === "string") throw new Error("No SMTP port.");
    driver = smtpMailer({
      driver: "smtp",
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      sender: "Sermo <sender@example.test>",
    });
    await driver.send({
      to: "reader@example.test",
      from: "Sermo <sender@example.test>",
      subject: "Message",
      html: "<p>HTML part</p>",
      text: "Plain part",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("HTML part");
    expect(raw).toContain("Plain part");
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  } finally {
    driver?.close?.();
    await new Promise<void>((resolve) => server.close(resolve));
  }
});

test("loopback hosts cover localhost, 127.0.0.0/8 and IPv6 loopback", () => {
  for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.255.0.9", "::1", "[::1]"])
    expect(isLoopbackHost(host)).toBe(true);
  for (const host of ["128.0.0.1", "127.0.0.256", "127.0.0", "localhost.example.test", "::2"])
    expect(isLoopbackHost(host)).toBe(false);
});

test("an explicit STARTTLS requirement applies to loopback relays too", async () => {
  const server = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("No SMTP port.");
  const driver = smtpMailer({
    driver: "smtp",
    host: "127.0.0.1",
    port: address.port,
    secure: false,
    requireTLS: true,
    sender: "sender@example.test",
  });
  try {
    await expect(
      driver.send({
        to: "reader@example.test",
        from: "sender@example.test",
        subject: "Message",
        html: "<p>HTML</p>",
        text: "Plain",
      }),
    ).rejects.toThrow();
  } finally {
    driver.close?.();
    await new Promise<void>((resolve) => server.close(resolve));
  }
});
