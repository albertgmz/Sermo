import { expect, test } from "bun:test";
import { shortAddress } from "./ip-address";

test("the loopback address in full is ::1", () => {
  expect(shortAddress("0000:0000:0000:0000:0000:0000:0000:0001")).toBe("::1");
  expect(shortAddress("::1")).toBe("::1");
});

test("an IPv4-mapped address is the IPv4 address", () => {
  expect(shortAddress("::ffff:192.0.2.7")).toBe("192.0.2.7");
  expect(shortAddress("0000:0000:0000:0000:0000:ffff:c000:0207")).toBe(
    "192.0.2.7",
  );
});

test("a full address is shortened: leading zeros dropped, the longest run of zeros becomes ::", () => {
  expect(shortAddress("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(
    "2001:db8::1",
  );
  expect(shortAddress("2001:0DB8:0000:0000:0001:0000:0000:0001")).toBe(
    "2001:db8::1:0:0:1",
  );
  expect(shortAddress("fe80:0000:0000:0000:0202:b3ff:fe1e:8329")).toBe(
    "fe80::202:b3ff:fe1e:8329",
  );
  expect(shortAddress("0000:0000:0000:0000:0000:0000:0000:0000")).toBe("::");
});

test("a single zero group is not shortened", () => {
  expect(shortAddress("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
});

test("an IPv4 address is left as it is", () => {
  expect(shortAddress("203.0.113.9")).toBe("203.0.113.9");
});

test("anything that is not an address is left as it is", () => {
  for (const text of [
    "unknown",
    "",
    "1:2:3",
    "1::2::3",
    "gggg::1",
    "::ffff:999.0.0.1",
    "12345::1",
  ]) {
    expect(shortAddress(text)).toBe(text);
  }
});
