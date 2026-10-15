import { NextResponse } from "next/server";

type Cookie = Record<string, unknown> & { name: string; value: string };

// What the browser is sent when an action sets a cookie: Next's own serialiser writes the
// Set-Cookie header, which encodes the value. `raw` is the value as it sits in the header, which is
// what `document.cookie` and a request's Cookie header carry afterwards; a reader that URL-decodes
// it once (the banner library does) gets back exactly the text that was set.
export function onTheWire(cookie: Cookie) {
  const response = new NextResponse();
  response.cookies.set(cookie as never);
  const header = response.headers.get("set-cookie") ?? "";
  return { header, raw: header.slice(header.indexOf("=") + 1).split(";")[0] };
}
