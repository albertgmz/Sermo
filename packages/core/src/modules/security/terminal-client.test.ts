import { expect, test } from "bun:test";
import { terminalClientName } from "./terminal-client";

test("a device login is named by its client and host", () => {
  expect(terminalClientName("sermo-cli", "sermo-cli/1.2.0 (linux/amd64; work-laptop)")).toBe(
    "sermo-cli · work-laptop",
  );
  expect(terminalClientName("sermo-cli", "sermo-cli/0.1.0 (darwin/arm64;Ana-MacBook.local)")).toBe(
    "sermo-cli · Ana-MacBook.local",
  );
});

test("only plain host characters are kept, and at most one DNS label's length", () => {
  expect(
    terminalClientName("sermo-cli", "sermo-cli/1.0 (linux/amd64; <b>evil</b> https://x.test)"),
  ).toBe("sermo-cli · bevilbhttpsx.test");
  const long = "a".repeat(100);
  expect(terminalClientName("sermo-cli", `sermo-cli/1.0 (linux/amd64; ${long})`)).toBe(
    `sermo-cli · ${"a".repeat(63)}`,
  );
});

test("without a host the client id alone names it", () => {
  expect(terminalClientName("sermo-cli", "sermo-cli/1.0 (linux/amd64; )")).toBe("sermo-cli");
  expect(terminalClientName("sermo-cli", "curl/8.0")).toBe("sermo-cli");
  expect(terminalClientName("sermo-cli", null)).toBe("sermo-cli");
});
