// Preloaded into the staging backend (`bun --preload`): `Bun.serve` listens on every interface
// unless told otherwise, and the server's configuration has no host setting. Staging answers
// administrator sign-ins with a known password, so it stays on this machine.
const serve = Bun.serve.bind(Bun) as (options: object) => unknown;
Object.assign(Bun, { serve: (options: object) => serve({ hostname: "127.0.0.1", ...options }) });
