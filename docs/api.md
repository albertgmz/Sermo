# API and MCP clients

Everything the web app does goes through the same REST API that other clients use. This guide
covers accounts, sign-in, API keys and the MCP endpoint. The routes and their request and response
schemas are in the OpenAPI document at `/api/v1/openapi.json`, which also covers every
`/api/auth/*` endpoint; the site draws it as a reference page at `/developer`. What each operation
allows, and the permission behind it, is in [administration.md](administration.md).

The examples use `http://localhost:3000`, the web app in [local development](../README.md#local-development),
which forwards `/api/*` and `/mcp` to the backend. On a Docker installation use the ingress origin
(`BETTER_AUTH_URL`, `http://localhost:8080` by default).

## Contents

- [Registration and sign-in](#registration-and-sign-in)
- [Email verification and account emails](#email-verification-and-account-emails)
- [Credentials](#credentials)
- [API keys](#api-keys)
- [MCP](#mcp)

## Registration and sign-in

Better Auth handles registration, sign-in, sessions and API keys under `/api/auth`.

- **Register:** `POST /api/auth/sign-up/email` with a JSON body holding `email`, `password`,
  `name` and `username`.
  - The username is required, 3 to 32 characters long, and may contain letters, numbers, spaces,
    `.`, `-` and `_`, with a letter or number at either end.
  - An optional `displayUsername` must match the username apart from letter case; `name` is free
    text.
  - Passwords are 8 to 256 characters.
- **Sign in:** `POST /api/auth/sign-in/email` (email and password) or
  `POST /api/auth/sign-in/username` (username and password).

## Email verification and account emails

When `SERMO_MAIL_DRIVER` is `capture` or `smtp`, new accounts join the Unconfirmed group. Better
Auth emails a link to verify the address; following it moves the account to Member and sends a
welcome email. The Unconfirmed group's permissions decide what the account can do until then. With
`SERMO_MAIL_DRIVER=none`, or with the `requireEmailConfirmation` setting off, registration joins
Member directly. Existing accounts keep their groups when email delivery is turned on.

Better Auth also provides:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/send-verification-email` | Send the verification link again. |
| `POST /api/auth/request-password-reset` | Email a reset link. The body must carry `redirectTo` on a trusted origin; Better Auth embeds it in the link and redirects there once the token is checked. |
| `POST /api/auth/reset-password` | Set the new password. A successful reset ends the account's other sessions. |
| `POST /api/auth/change-password` | Change the password. |
| `POST /api/auth/change-email` | Change the address; the change is confirmed at the new address. |

Password and email changes, API key creation and bans send security notices. These cannot be
unsubscribed from and do not count against the notification email cap. Verification, reset and
change-email requests are limited per client IP. The full list of account emails is in
[administration.md, "Account emails"](administration.md#account-emails).

## Credentials

- **Browsers** use the session cookie.
- **REST and MCP clients** send an API key as `Authorization: Bearer <key>` or `x-api-key: <key>`.
  A key has the same permissions as its owner.
- **No credentials** means the request runs as a guest. Any credential that is presented and
  invalid is refused; it never falls back to a guest.

Exceptions and checks:

- Changing groups, permissions, moderators and promotions (`groups.create`, `groups.update`,
  `groups.delete`, `users.setGroups`, `users.setSuperAdmin`, `permissions.set`,
  `nodes.setModerator`, `promotions.create`, `promotions.update`, `promotions.delete`,
  `promotions.apply`) refuses an API key, whether or not it sends a password. A signed-in session
  must send the administrator's own password as `actorPassword`.
- Cookie-carrying `POST` requests to `/api/auth/*`, including API key creation, need an `Origin`
  header equal to `BETTER_AUTH_URL` (or one of `SERMO_TRUSTED_ORIGINS`); Better Auth rejects a
  missing origin.
- Cookie-authenticated REST writes also need `Content-Type: application/json`.

The HTTP adapter limits each client per minute to 300 reads (GET and HEAD), 60 writes, 30 searches
and 60 MCP requests, counted per API key, per signed-in member, or per IP for guests
(`SERMO_RATE_LIMIT_*` changes them). Better Auth limits its own sign-in and sign-up endpoints
separately.

## API keys

A member has one key. Signed-in members create, replace and revoke it on the API and agents page of
their account (`/account/api`). Over HTTP, sign in, then call the key creation endpoint with that
session. In a POSIX shell, with `SERMO_USERNAME` and `SERMO_PASSWORD` set:

```sh
cookie_file=$(mktemp)
curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d "{\"username\":\"$SERMO_USERNAME\",\"password\":\"$SERMO_PASSWORD\"}" \
  http://localhost:3000/api/auth/sign-in/username
curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"name":"mcp-client"}' http://localhost:3000/api/auth/api-key/create
rm -f "$cookie_file"
```

The shell-built JSON needs proper escaping if the username or password contains `"` or `\`.

- Copy the returned `key` at once; it is not shown again.
- A second request is refused with 409 (`API_KEY_EXISTS`) unless its body also has
  `"replace": true`, which ends the member's other keys once the new one exists.
- An API key cannot create or revoke keys; manage them with a session.

## MCP

The MCP endpoint is stateless Streamable HTTP at `/mcp`. Each operation is a tool whose name
replaces the dots with underscores: `posts.create` becomes `posts_create`. A raw tool list:

```sh
curl -sS http://localhost:3000/mcp \
  -H 'Authorization: Bearer sermo_your_key_here' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A client that supports Streamable HTTP can use this configuration; the `type` value varies by
client:

```json
{
  "mcpServers": {
    "sermo": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer sermo_your_key_here" }
    }
  }
}
```
