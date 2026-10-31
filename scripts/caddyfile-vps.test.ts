import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The server's Caddyfile as the deploy makes it from the shipped one.
const root = resolve(import.meta.dir, "..");
const run = Bun.spawnSync(["bash", "deploy/caddyfile-vps.sh", "Caddyfile"], { cwd: root });
const vps = run.stdout.toString();
const shipped = readFileSync(resolve(root, "Caddyfile"), "utf8");

test("the server's Caddyfile trusts the visitor address only from the tunnel", () => {
  expect(run.exitCode).toBe(0);
  expect(vps).toContain(
    "\tauto_https off\n\tservers {\n\t\ttrusted_proxies static 172.30.40.10/32\n" +
      "\t\tclient_ip_headers Cf-Connecting-IP\n\t}\n}",
  );
});

test("the server's Caddyfile lets Cloudflare's location headers through to both upstreams", () => {
  expect(shipped).toContain("header_up -CF-IPCountry");
  expect(vps).not.toMatch(/header_up -CF-/);
});

test("the server's Caddyfile keeps every other rule of the shipped one", () => {
  const kept = shipped
    .split("\n")
    .filter((line) => !/header_up -CF-/.test(line))
    .join("\n");
  const added = /\tservers \{\n\t\ttrusted_proxies[^\n]*\n\t\tclient_ip_headers[^\n]*\n\t\}\n/;
  expect(vps.replace(added, "")).toBe(kept);
});
