const assert = require("assert");
const { isTomTomQuotaError, stoppedAfterArrival, tomtomRefreshMs, tomtomRuntimeInfo } = require("../../dist/server/server/src/adapters/tomtom");

assert.strictEqual(stoppedAfterArrival("09:00", new Date("2026-05-18T00:59:00.000Z")), false);
assert.strictEqual(stoppedAfterArrival("09:00", new Date("2026-05-18T01:01:00.000Z")), true);
assert.strictEqual(stoppedAfterArrival(undefined, new Date("2026-05-18T01:01:00.000Z")), false);

assert.strictEqual(tomtomRefreshMs({}), 10 * 60 * 1000);
assert.strictEqual(tomtomRefreshMs({ RENDER: "true" }), 2 * 60 * 1000);
assert.strictEqual(tomtomRefreshMs({ RENDER_SERVICE_ID: "srv-test" }), 2 * 60 * 1000);
assert.strictEqual(tomtomRefreshMs({ NODE_ENV: "production" }), 2 * 60 * 1000);
assert.strictEqual(tomtomRefreshMs({ TOMTOM_REFRESH_MS: "12345" }), 12345);

assert.strictEqual(isTomTomQuotaError({ status: 403, body: '{"code":"InsufficientFunds"}' }), true);
assert.strictEqual(isTomTomQuotaError({ status: 429, body: "rate limit exceeded" }), true);
assert.strictEqual(isTomTomQuotaError({ status: 500, body: "server error" }), false);

const runtimeInfo = tomtomRuntimeInfo();
assert.strictEqual(typeof runtimeInfo.primaryConfigured, "boolean");
assert.strictEqual(typeof runtimeInfo.backupConfigured, "boolean");
assert.strictEqual(typeof runtimeInfo.refreshMinutes, "number");
assert.strictEqual(typeof runtimeInfo.primaryQuotaBlocked, "boolean");

console.log("tomtom refresh tests passed");
