const assert = require("assert");
const { terminalNamesMatch } = require("../../dist/server/server/src/adapters/bus");

assert.strictEqual(terminalNamesMatch("KAI TAK (KAI CHING ESTATE)", "Kai Ching Estate"), true);
assert.strictEqual(terminalNamesMatch("CENTRAL (MACAO FERRY)", "Central (Macao Ferry)"), true);
assert.strictEqual(terminalNamesMatch("DIAMOND HILL STATION", "Diamond Hill Station"), true);
assert.strictEqual(terminalNamesMatch("AP LEI CHAU LEE LOK ST", "Ap Lei Chau (Lee Lok Street)"), true);
assert.strictEqual(terminalNamesMatch("CENTRAL (MACAO FERRY)", "Kai Ching Estate"), false);

console.log("bus direction tests passed");
