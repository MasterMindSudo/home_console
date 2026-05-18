const assert = require("assert");
const { terminalNamesMatch } = require("../../dist/server/server/src/adapters/bus");

assert.strictEqual(terminalNamesMatch("KAI TAK (KAI CHING ESTATE)", "Kai Ching Estate"), true);
assert.strictEqual(terminalNamesMatch("CENTRAL (MACAO FERRY)", "Central (Macao Ferry)"), true);
assert.strictEqual(terminalNamesMatch("DIAMOND HILL STATION", "Diamond Hill Station"), true);
assert.strictEqual(terminalNamesMatch("AP LEI CHAU LEE LOK ST", "Ap Lei Chau (Lee Lok Street)"), true);
assert.strictEqual(terminalNamesMatch("PING SHEK / CHOI HUNG STATION", "Ping Shek Estate"), true);
assert.strictEqual(terminalNamesMatch("LEE ON", "Lee On Estate"), true);
assert.strictEqual(terminalNamesMatch("CAUSEWAY BAY (TIN HAU)", "Tin Hau Station"), true);
assert.strictEqual(terminalNamesMatch("SHATIN STATION", "Sha Tin Station"), true);
assert.strictEqual(terminalNamesMatch("ADMIRALTY STATION (EAST)", "Admiralty - MTR Exit D"), true);
assert.strictEqual(terminalNamesMatch("CENTRAL (MACAO FERRY)", "Kai Ching Estate"), false);
assert.strictEqual(terminalNamesMatch("CENTRAL (MACAO FERRY)", "Central (Exchange Square)"), false);
assert.strictEqual(terminalNamesMatch("WAN CHAI", "Fleming Road, Hennessy Road"), false);

console.log("bus direction tests passed");
