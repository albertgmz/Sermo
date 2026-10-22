import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "smilies.list",
    kind: "read",
    run: (env) => env.call("smilies.list", env.actors.guest, {}),
  },
];
