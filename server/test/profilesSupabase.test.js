const assert = require("assert");
const { createSupabaseProfileStore } = require("../../dist/server/server/src/db/profiles");

function createFakeSupabaseClient() {
  const rows = [];

  function sortRows() {
    rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  function table() {
    return {
      select() {
        return {
          order(column, options = {}) {
            const ordered = [...rows].sort((a, b) => {
              if (a[column] === b[column]) return 0;
              return options.ascending === false
                ? (a[column] < b[column] ? 1 : -1)
                : (a[column] < b[column] ? -1 : 1);
            });
            return Promise.resolve({ data: ordered, error: null });
          },
          eq(column, value) {
            const matched = rows.filter((row) => row[column] === value);
            return Promise.resolve({ data: matched, error: null });
          }
        };
      },
      insert(payload) {
        rows.push({ ...payload });
        sortRows();
        return Promise.resolve({ error: null });
      },
      update(payload) {
        return {
          eq(column, value) {
            const index = rows.findIndex((row) => row[column] === value);
            if (index >= 0) {
              rows[index] = { ...rows[index], ...payload };
              sortRows();
            }
            return Promise.resolve({ error: null });
          }
        };
      },
      delete() {
        return {
          eq(column, value) {
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              if (rows[i][column] === value) rows.splice(i, 1);
            }
            return Promise.resolve({ error: null, count: before - rows.length });
          }
        };
      }
    };
  }

  return {
    rows,
    from(name) {
      assert.strictEqual(name, "profiles");
      return table();
    }
  };
}

async function run() {
  const client = createFakeSupabaseClient();
  const store = createSupabaseProfileStore(client);

  const created = await store.create({
    name: "GF morning work",
    latestArrivalTime: "09:00",
    car: {
      origin: { lat: 22.31, lng: 114.22 },
      destination: { lat: 22.24, lng: 114.17 }
    },
    walkTimes: {
      car: { toStartMinutes: 2, fromDestinationMinutes: 5 }
    }
  });

  assert.strictEqual(created.name, "GF morning work");
  assert.deepStrictEqual(created.walkTimes, {
    car: { toStartMinutes: 2, fromDestinationMinutes: 5 }
  });

  const listed = await store.list();
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].id, created.id);

  const fetched = await store.get(created.id);
  assert.strictEqual(fetched.id, created.id);
  assert.deepStrictEqual(fetched.walkTimes, created.walkTimes);

  const updated = await store.update(created.id, {
    name: "GF morning commute",
    latestArrivalTime: "08:55",
    bus: {
      route: "671",
      direction: "outbound",
      originStopId: "A",
      destinationStopId: "B"
    }
  });

  assert.strictEqual(updated.name, "GF morning commute");
  assert.strictEqual(updated.latestArrivalTime, "08:55");
  assert.strictEqual(updated.bus.route, "671");
  assert.strictEqual(updated.walkTimes, undefined);

  assert.strictEqual(await store.delete(created.id), true);
  assert.strictEqual(await store.get(created.id), undefined);
  assert.deepStrictEqual(await store.list(), []);
}

run()
  .then(() => console.log("supabase profile store tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
