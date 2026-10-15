import { warmUpRenderer } from "../render";
import { createTestContext } from "../testing";

// Run by adversarial.test.ts in a fresh process: prints whether the renderer was still cold
// after (`after`) or before (`before`) a context was created.
if (process.argv[2] === "after") createTestContext();
console.log(warmUpRenderer() ? "cold" : "warm");
