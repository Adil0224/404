import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "30s",
  thresholds: { http_req_failed: ["rate<0.02"], http_req_duration: ["p(95)<1000"] }
};

const base = __ENV.API_URL || "http://localhost:3000";
export default function () {
  const health = http.get(base + "/api/health");
  check(health, { "health is ready": (r) => r.status === 200 });
  const doctors = http.get(base + "/api/doctors?page=1&limit=10");
  check(doctors, { "doctor list responds": (r) => r.status === 200 });
  sleep(1);
}
