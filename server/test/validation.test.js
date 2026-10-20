import test from "node:test";
import assert from "node:assert/strict";
import { apiError, isUuid, listOptions, validAppointmentTime } from "../src/validation.js";

test("pagination uses safe defaults and allowlisted sorting", () => {
  assert.deepEqual(listOptions({}, { name: "full_name" }, "name"), {
    page: 1, limit: 10, offset: 0, sort: "full_name", direction: "ASC"
  });
  assert.equal(listOptions({ page: "3", limit: "5", sort: "name", order: "DESC" }, { name: "full_name" }, "name").offset, 10);
});

test("pagination rejects invalid values and unsupported sort fields", () => {
  assert.throws(() => listOptions({ page: "0" }, { name: "full_name" }, "name"), (error) => error.status === 400);
  assert.throws(() => listOptions({ limit: "51" }, { name: "full_name" }, "name"), (error) => error.status === 400);
  assert.throws(() => listOptions({ sort: "full_name; DROP TABLE users" }, { name: "full_name" }, "name"), (error) => error.status === 400);
  assert.equal(apiError(409, "conflict").status, 409);
});

test("UUID and appointment time validators reject malformed values", () => {
  assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  const now = Date.parse("2030-01-01T00:00:00Z");
  assert.equal(validAppointmentTime("2030-01-02T10:00:00+05:00", now), true);
  assert.equal(validAppointmentTime("2029-12-31T10:00:00+05:00", now), false);
  assert.equal(validAppointmentTime("2030-01-02", now), false);
});
