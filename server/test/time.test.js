const assert = require("assert");
const { classifyArrival, minutesUntil, pairBusEtas } = require("../../dist/server/server/src/services/time");

const now = new Date("2026-05-15T00:00:00.000Z");

assert.strictEqual(classifyArrival("2026-05-15T00:50:00.000Z", "08:55", now), "on_time");
assert.strictEqual(classifyArrival("2026-05-15T01:05:00.000Z", "08:55", now), "late");
assert.strictEqual(classifyArrival(undefined, "08:55", now), "unknown");
assert.strictEqual(minutesUntil("2026-05-15 08:05:00", new Date("2026-05-15T00:00:00.000Z")), 5);
assert.strictEqual(minutesUntil("2026-05-15T08:05:00+08:00", new Date("2026-05-15T00:00:00.000Z")), 5);

const pairs = pairBusEtas(
  [{ eta: "2026-05-15T00:10:00.000Z", minutes: 10 }],
  [{ eta: "2026-05-15T00:45:00.000Z", minutes: 45 }],
  "08:55"
);

assert.strictEqual(pairs.length, 1);
assert.strictEqual(pairs[0].confidence, "operator_order");
assert.strictEqual(pairs[0].arrivalStatus, "on_time");

const mixedOperatorPairs = pairBusEtas(
  [
    { eta: "2026-05-15T00:11:00.000Z", minutes: 11, operator: "CTB", etaSequence: 1 },
    { eta: "2026-05-15T00:42:00.000Z", minutes: 42, operator: "CTB", etaSequence: 2 }
  ],
  [
    { eta: "2026-05-15T00:19:00.000Z", minutes: 19, operator: "KMB", etaSequence: 1 },
    { eta: "2026-05-15T00:45:00.000Z", minutes: 45, operator: "CTB", etaSequence: 1 }
  ],
  "08:55"
);

assert.strictEqual(mixedOperatorPairs[0].origin.operator, "CTB");
assert.strictEqual(mixedOperatorPairs[0].destination.operator, "CTB");
assert.strictEqual(mixedOperatorPairs[0].destination.minutes, 45);
assert.strictEqual(mixedOperatorPairs[0].confidence, "operator_order");

const exactRunPairs = pairBusEtas(
  [{ eta: "2026-05-15T00:11:00.000Z", minutes: 11, operator: "CTB", runId: "abc" }],
  [
    { eta: "2026-05-15T00:19:00.000Z", minutes: 19, operator: "CTB", runId: "other" },
    { eta: "2026-05-15T00:45:00.000Z", minutes: 45, operator: "CTB", runId: "abc" }
  ],
  "08:55"
);

assert.strictEqual(exactRunPairs[0].destination.minutes, 45);
assert.strictEqual(exactRunPairs[0].confidence, "exact");

const impossibleEarlierDestinationPairs = pairBusEtas(
  [{ eta: "2026-05-15T00:11:00.000Z", minutes: 11, operator: "CTB", etaSequence: 1 }],
  [
    { eta: "2026-05-15T00:09:00.000Z", minutes: 9, operator: "CTB", etaSequence: 1 },
    { eta: "2026-05-15T00:45:00.000Z", minutes: 45, operator: "CTB", etaSequence: 2 }
  ],
  "08:55"
);

assert.strictEqual(impossibleEarlierDestinationPairs[0].destination.minutes, 45);
assert.strictEqual(impossibleEarlierDestinationPairs[0].confidence, "operator_order");

const tooCloseDestinationPairs = pairBusEtas(
  [{ eta: "2026-05-15T00:06:00.000Z", minutes: 6, operator: "KMB", etaSequence: 1 }],
  [
    { eta: "2026-05-15T00:07:00.000Z", minutes: 7, operator: "KMB", etaSequence: 1 },
    { eta: "2026-05-15T00:45:00.000Z", minutes: 45, operator: "KMB", etaSequence: 2 }
  ],
  "08:55"
);

assert.strictEqual(tooCloseDestinationPairs[0].destination.minutes, 45);
assert.strictEqual(tooCloseDestinationPairs[0].confidence, "operator_order");

const noPlausibleDestinationPairs = pairBusEtas(
  [{ eta: "2026-05-15T00:06:00.000Z", minutes: 6, operator: "KMB", etaSequence: 1 }],
  [{ eta: "2026-05-15T00:07:00.000Z", minutes: 7, operator: "KMB", etaSequence: 1 }],
  "08:55"
);

assert.strictEqual(noPlausibleDestinationPairs[0].destination, undefined);
assert.strictEqual(noPlausibleDestinationPairs[0].arrivalStatus, "unknown");
assert.strictEqual(noPlausibleDestinationPairs[0].confidence, "unavailable");

console.log("time service tests passed");
