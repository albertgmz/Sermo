import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

const scratch = mkdtempSync(join(tmpdir(), "sermo-caddyfile-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The script on a Caddyfile with this text, or on a path that does not exist.
const runOn = (text: string | null) => {
  const path = join(scratch, "Caddyfile");
  rmSync(path, { force: true });
  if (text !== null) writeFileSync(path, text);
  const result = Bun.spawnSync(["bash", "deploy/caddyfile-vps.sh", path], { cwd: root });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
};

test("the script refuses a Caddyfile that does not exist", () => {
  const result = runOn(null);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("No such file");
});

test("the script refuses a Caddyfile with no global auto_https line", () => {
  const result = runOn(":8080 {\n\trespond 200\n}\n");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('no line "auto_https off"');
});

test("the script refuses a location header line it cannot delete", () => {
  const result = runOn(
    "{\n\tauto_https off\n}\n:8080 {\n\treverse_proxy web:3000 {\n    header_up -CF-Region\n\t}\n}\n",
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("location header line");
});
