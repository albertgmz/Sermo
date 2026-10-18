// Every other /.well-known address. The files the backend publishes there are rewritten to it before
// this route is tried (next.config.ts), and the web app's own have their routes beside this one: a
// client asking for one the site does not publish is told so in plain text, not with the HTML page.
export function GET() {
  return new Response("Not found.\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
