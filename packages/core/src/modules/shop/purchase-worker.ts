import { parentPort, workerData } from "node:worker_threads";
import { closeContext, createContext } from "../../context";
import { ConflictError } from "../../errors";
import { execute } from "../../operation";
import { buy } from "./inventory";

const input = workerData as {
  path: string;
  userId: number;
  itemId: number;
  gate: SharedArrayBuffer;
};
const ctx = createContext({ path: input.path, config: { validateOutput: true } });
const gate = new Int32Array(input.gate);
parentPort!.postMessage("ready");
Atomics.wait(gate, 0, 0);
try {
  await execute(
    ctx,
    buy,
    { kind: "user", userId: input.userId, groupId: 2, sessionId: 0 },
    { itemId: input.itemId },
  );
  parentPort!.postMessage("bought");
} catch (error) {
  if (!(error instanceof ConflictError)) throw error;
  parentPort!.postMessage("conflict");
} finally {
  closeContext(ctx);
  parentPort!.close();
}
