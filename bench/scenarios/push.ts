import { configurePush } from "@sermo/core";
import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "push.subscribe device",
    kind: "write",
    setup: (env) => {
      configurePush(env.ctx, {
        vapid: {
          publicKey:
            "BGtkbcjrO12YMoDuq2sCQeHlu47uPx3SHTgFKZFYiBW8Qr0D9vgyZSZPdw6_4ZFEI9Snk1VEAj2qTYI1I1YxBXE",
          privateKey: "I0_d0vnesxbBSUmlDdOKibGo6vEXRO-Vu88QlSlm5j0",
          subject: "mailto:bench@example.test",
        },
      });
    },
    run: (env, i) =>
      env.call("push.subscribe", env.actors.member(0), {
        endpoint: `https://fcm.googleapis.com/device-${i}`,
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
        userAgent: "benchmark",
      }),
  },
];
