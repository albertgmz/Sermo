import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "site.get",
    kind: "read",
    run: (env) => env.call("site.get", env.actors.guest, {}),
  },
  {
    name: "paletteColors.list name colours",
    kind: "read",
    run: (env) => env.call("paletteColors.list", env.actors.guest, { kind: "name" }),
  },
  {
    name: "catalogImages.list frames",
    kind: "read",
    run: (env) => env.call("catalogImages.list", env.actors.guest, { kind: "frame" }),
  },
];
