import { mock } from "bun:test";

// Loaded before every test file (bunfig.toml). `server-only` resolves only under Next's
// react-server condition, so outside a Next build every module that imports it would fail to load.
mock.module("server-only", () => ({}));
