const assert = require("assert");
const { stoppedAfterArrival } = require("../../dist/server/server/src/adapters/tomtom");

assert.strictEqual(stoppedAfterArrival("09:00", new Date("2026-05-18T00:59:00.000Z")), false);
assert.strictEqual(stoppedAfterArrival("09:00", new Date("2026-05-18T01:01:00.000Z")), true);
assert.strictEqual(stoppedAfterArrival(undefined, new Date("2026-05-18T01:01:00.000Z")), false);

console.log("tomtom cache tests passed");
