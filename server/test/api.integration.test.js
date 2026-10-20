import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.TEST_API_URL || "http://localhost:3000";

test("API health, directory, pagination and validation respond correctly", async () => {
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const doctors = await fetch(base + "/api/doctors?page=1&limit=3&sort=name&order=asc");
  assert.equal(doctors.status, 200);
  const payload = await doctors.json();
  assert.equal(payload.data.length <= 3, true);
  assert.equal(payload.pagination.page, 1);
  assert.equal(typeof payload.pagination.total, "number");

  const invalid = await fetch(base + "/api/doctors?page=0");
  assert.equal(invalid.status, 400);

  const branches = await fetch(base + "/api/branches");
  assert.equal(branches.status, 200);
  assert.equal(Array.isArray((await branches.json()).data), true);
});
