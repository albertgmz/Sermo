import { check, sleep } from "k6";
import http from "k6/http";

// Addresses and files come from the environment (k6 -e NAME=value).
export const API = __ENV.API_URL || "http://127.0.0.1:4401";
export const ORIGIN = __ENV.WEB_URL || "http://localhost:4400";
export const META = __ENV.META;

// The web app sends the same GET and JSON requests; see load/README.md for the operations.
export const OPS = [
  "auth.signIn",
  "site.get",
  "feed.list",
  "feed.newCount",
  "nodes.list",
  "nodes.get",
  "threads.list",
  "threads.get",
  "posts.list",
  "profiles.get",
  "search.query",
  "conversations.list",
  "conversations.get",
  "conversations.listMessages",
  "auth.counters",
  "posts.create",
  "conversations.reply",
];

// Kept apart from the default per-VU cookie jar: the session goes in an explicit header.
const noJar = new http.CookieJar();
const reported = {};

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function think(min, max) {
  sleep(min + Math.random() * (max - min));
}

function headers(session, write) {
  const h = { Accept: "application/json" };
  if (session) h.Cookie = `sermo.session_token=${session.cookie}`;
  if (write) {
    h["Content-Type"] = "application/json";
    h.Origin = ORIGIN;
  }
  return h;
}

function query(params) {
  const parts = [];
  for (const key of Object.keys(params || {}))
    if (params[key] !== undefined && params[key] !== null)
      parts.push(`${key}=${encodeURIComponent(params[key])}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

function finish(op, res) {
  const ok = check(res, { [`${op} answers 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  // A few failures are printed per VU so that a broken flow shows up in the first run.
  if (!ok) {
    reported[op] = (reported[op] || 0) + 1;
    if (reported[op] <= 2) console.warn(`${op}: ${res.status} ${String(res.body).slice(0, 160)}`);
  }
  return res;
}

export function read(op, path, params, session) {
  const res = http.get(`${API}/api/v1${path}${query(params)}`, {
    headers: headers(session, false),
    jar: noJar,
    tags: { name: op, kind: "read" },
  });
  return finish(op, res);
}

export function write(op, path, body, session) {
  const res = http.post(`${API}/api/v1${path}`, JSON.stringify(body), {
    headers: headers(session, true),
    jar: noJar,
    tags: { name: op, kind: "write" },
  });
  return finish(op, res);
}

export function json(res) {
  try {
    return res.json();
  } catch (_) {
    return null;
  }
}

/** Signs one member in, waiting out Better Auth's own limit (3 per 10 s per address) if met. */
export function signIn(id, password) {
  const body = JSON.stringify({
    email: `user${id}@example.test`,
    password,
    rememberMe: true,
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = http.post(`${API}/api/auth/sign-in/email`, body, {
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      jar: noJar,
      tags: { name: "auth.signIn", kind: "setup" },
    });
    const cookie = res.cookies["sermo.session_token"];
    if (res.status === 200 && cookie && cookie.length > 0) return cookie[0].value;
    if (res.status === 429) {
      sleep(11);
      continue;
    }
    console.error(`sign-in of member ${id}: ${res.status} ${String(res.body).slice(0, 160)}`);
    return null;
  }
  return null;
}
