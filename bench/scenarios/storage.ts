import type { Scenario } from "../harness";

let fileIds: number[] = [];

export const scenarios: Scenario[] = [
  {
    name: "files.get seeded attachment",
    kind: "read",
    setup(env) {
      fileIds = env.ctx.sqlite
        .prepare<{ id: number }, []>("SELECT id FROM files ORDER BY id LIMIT 100")
        .all()
        .map((row) => row.id);
      if (fileIds.length < 100) throw new Error("Storage benchmark seed has no files.");
    },
    run(env, i) {
      return env.call("files.get", env.actors.admin, { fileId: fileIds[i % fileIds.length]! });
    },
  },
];
