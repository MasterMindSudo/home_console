const assert = require("assert");
const {
  aggregateTrafficFlow,
  normalizeRoadName,
  parseSegmentInfoCsv,
  parseSpeedXml
} = require("../../dist/server/server/src/adapters/trafficFlow");

assert.strictEqual(normalizeRoadName("Waterloo Rd. southbound"), "WATERLOO ROAD SOUTHBOUND");
assert.strictEqual(normalizeRoadName("ROUTE 1"), "1");
assert.strictEqual(normalizeRoadName("Hiram's Highway"), "HIRAM S HIGHWAY");

const speeds = parseSpeedXml(`
<segment_speed_list>
  <date>2026-05-18</date>
  <time>08:15:00</time>
  <segments>
    <segment><segment_id>1</segment_id><speed>62.5</speed><valid>Y</valid></segment>
    <segment><segment_id>2</segment_id><speed>22.0</speed><valid>Y</valid></segment>
    <segment><segment_id>3</segment_id><speed>50</speed><valid>N</valid></segment>
    <segment><segment_id>4</segment_id><speed></speed><valid>Y</valid></segment>
  </segments>
</segment_speed_list>
`);

assert.strictEqual(speeds.updatedAt, "2026-05-18T08:15:00+08:00");
assert.strictEqual(speeds.items.length, 4);
assert.strictEqual(speeds.items[0].speedKph, 62.5);
assert.strictEqual(speeds.items[2].valid, false);
assert.strictEqual(speeds.items[3].speedKph, undefined);

const segmentInfo = parseSegmentInfoCsv(`irn_id,ucase(route)
1,WATERLOO ROAD
2,WATERLOO ROAD
3,WATERLOO ROAD
4,ROUTE 1
5,UNMATCHED ROAD
6,LEI YUE MUN ROAD
7,KWUN TONG BY-PASS
8,ISLAND EASTERN CORRIDOR
9,GLOUCESTER ROAD
`);

const roads = aggregateTrafficFlow(["Waterloo Rd.", "Route 1", "Missing Road"], segmentInfo, speeds);
assert.strictEqual(roads.length, 1);
assert.strictEqual(roads[0].roadName, "WATERLOO ROAD");
assert.strictEqual(roads[0].representativeSpeedKph, 42.3);
assert.strictEqual(roads[0].slowestSpeedKph, 22);
assert.strictEqual(roads[0].validSegmentCount, 2);
assert.strictEqual(roads[0].invalidSegmentCount, 1);
assert.strictEqual(roads[0].status, "moderate");

const sentenceRoads = aggregateTrafficFlow(["Take ramp toward Route 1"], segmentInfo, speeds);
assert.strictEqual(sentenceRoads.length, 0);
assert.strictEqual(aggregateTrafficFlow(["Hiram's Highway"], parseSegmentInfoCsv("irn_id,ucase(route)\n9,HIRAM'S HIGHWAY\n"), { items: [{ segmentId: "9", speedKph: 0, valid: true }] })[0].status, "slow");
assert.strictEqual(aggregateTrafficFlow(["Kwun Tong Bypass"], segmentInfo, { items: [{ segmentId: "7", speedKph: 55, valid: true }] })[0].roadName, "KWUN TONG BY-PASS");

const duplicateRoads = aggregateTrafficFlow(["Kwun Tong Road", "Keep right at Kwun Tong Road toward Hong Kong"], parseSegmentInfoCsv("irn_id,ucase(route)\n10,KWUN TONG ROAD\n11,KWUN TONG ROAD\n"), {
  items: [
    { segmentId: "10", speedKph: 70, valid: true },
    { segmentId: "11", speedKph: 70, valid: true }
  ]
});
assert.strictEqual(duplicateRoads.length, 1);

const corridorRoads = aggregateTrafficFlow(["Lei Yue Mun Road", "Eastern Harbour Crossing Tunnel", "Island Eastern Corridor"], segmentInfo, {
  items: [
    { segmentId: "6", speedKph: 35, valid: true },
    { segmentId: "7", speedKph: 55, valid: true },
    { segmentId: "8", speedKph: 62, valid: true },
    { segmentId: "9", speedKph: 48, valid: true }
  ]
});
assert.deepStrictEqual(corridorRoads.map((road) => road.roadName), ["LEI YUE MUN ROAD", "KWUN TONG BY-PASS", "ISLAND EASTERN CORRIDOR", "GLOUCESTER ROAD"]);

console.log("traffic flow tests passed");
