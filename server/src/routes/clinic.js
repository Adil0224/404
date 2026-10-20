import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

export const clinicRouter = Router();

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function listOptions(query, allowedSorts, defaultSort) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 10 : Number(query.limit);
  const sortKey = query.sort === undefined ? defaultSort : String(query.sort);
  const order = query.order === undefined ? "asc" : String(query.order).toLowerCase();
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw apiError(400, "Page must be positive and limit must be between 1 and 50.");
  }
  if (!Object.hasOwn(allowedSorts, sortKey) || !["asc", "desc"].includes(order)) {
    throw apiError(400, "Choose a supported sort field and order.");
  }
  return { page, limit, offset: (page - 1) * limit, sort: allowedSorts[sortKey], direction: order.toUpperCase() };
}

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validAppointmentTime(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) > Date.now();
}

async function slotIsAvailable({ doctorId, branchId, serviceId, startsAt, excludeAppointmentId = null }) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM doctor_schedules ds
       JOIN doctors d ON d.id = ds.doctor_id AND d.is_active = TRUE
       JOIN branches b ON b.id = ds.branch_id AND b.is_active = TRUE
       LEFT JOIN services s ON s.id = $3 AND s.is_active = TRUE
       WHERE ds.doctor_id = $1
         AND ds.branch_id = $2
         AND ds.is_active = TRUE
         AND ds.weekday = EXTRACT(DOW FROM ($4::timestamptz AT TIME ZONE 'Asia/Almaty'))::int
         AND ($4::timestamptz AT TIME ZONE 'Asia/Almaty')::time >= ds.starts_at
         AND ($4::timestamptz AT TIME ZONE 'Asia/Almaty')::time
             + make_interval(mins => COALESCE(s.duration_minutes, 30)) <= ds.ends_at
         AND FLOOR(EXTRACT(EPOCH FROM (
             ($4::timestamptz AT TIME ZONE 'Asia/Almaty')::time - ds.starts_at
           )) / 60)::int % ds.slot_minutes = 0
         AND ($3::uuid IS NULL OR s.id IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM appointments occupied
           WHERE occupied.doctor_id = $1 AND occupied.status = 'booked'
             AND ($5::uuid IS NULL OR occupied.id <> $5::uuid)
             AND tstzrange(
               occupied.starts_at,
               occupied.starts_at + make_interval(mins => occupied.duration_minutes),
               '[)'
             ) && tstzrange(
               $4::timestamptz,
               $4::timestamptz + make_interval(mins => COALESCE(s.duration_minutes, 30)),
               '[)'
             )
         )
     ) AS available`,
    [doctorId, branchId, serviceId || null, startsAt, excludeAppointmentId]
  );
  return result.rows[0].available;
}

function isConflict(error) {
  return error.code === "23505" || error.code === "23P01";
}

clinicRouter.get("/doctors", async (request, response) => {
  const options = listOptions(request.query, { name: "d.full_name", specialty: "d.specialty", experience: "d.experience_years" }, "name");
  const values = [];
  const filters = ["d.is_active = TRUE"];
  if (request.query.q) {
    values.push(`%${String(request.query.q).slice(0, 100)}%`);
    filters.push(`(d.full_name ILIKE $${values.length} OR d.specialty ILIKE $${values.length})`);
  }
  if (request.query.specialty) {
    values.push(String(request.query.specialty).slice(0, 120));
    filters.push(`d.specialty ILIKE $${values.length}`);
  }
  if (request.query.branch) {
    values.push(String(request.query.branch).slice(0, 40));
    filters.push(`EXISTS (
      SELECT 1 FROM doctor_branches db JOIN branches b ON b.id = db.branch_id
      WHERE db.doctor_id = d.id AND b.is_active = TRUE AND b.public_code = $${values.length}
    )`);
  }
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM doctors d WHERE ${filters.join(" AND ")}`,
    values
  );
  const total = totalResult.rows[0].total;
  const result = await pool.query(
    `SELECT d.id, d.public_code AS code, d.full_name AS "fullName",
            d.specialty, d.description, d.experience_years AS "experienceYears",
            COALESCE(json_agg(json_build_object(
              'id', b.id, 'code', b.public_code, 'name', b.name, 'address', b.address
            )) FILTER (WHERE b.id IS NOT NULL AND b.is_active = TRUE), '[]') AS branches
     FROM doctors d
     LEFT JOIN doctor_branches db ON db.doctor_id = d.id
     LEFT JOIN branches b ON b.id = db.branch_id
     WHERE ${filters.join(" AND ")}
     GROUP BY d.id
     ORDER BY ${options.sort} ${options.direction}
     LIMIT ${options.limit} OFFSET ${options.offset}`,
    values
  );
  response.json({ data: result.rows, pagination: { page: options.page, limit: options.limit, total, pages: Math.ceil(total / options.limit) } });
});

clinicRouter.get("/branches", async (_request, response) => {
  const result = await pool.query(
    "SELECT id, public_code AS code, name, address, map_url AS \"mapUrl\" FROM branches WHERE is_active = TRUE ORDER BY name"
  );
  response.json({ data: result.rows });
});

clinicRouter.get("/services", async (_request, response) => {
  const result = await pool.query(
    "SELECT id, public_code AS code, name, price_kzt AS \"priceKzt\", duration_minutes AS \"durationMinutes\" FROM services WHERE is_active = TRUE ORDER BY name"
  );
  response.json({ data: result.rows });
});

clinicRouter.get("/reviews", async (_request, response) => {
  const result = await pool.query(
    "SELECT r.id, r.rating, r.body, r.created_at AS \"createdAt\", u.full_name AS \"patientName\" FROM reviews r JOIN users u ON u.id = r.patient_id WHERE r.is_published = TRUE ORDER BY r.created_at DESC"
  );
  response.json({ data: result.rows });
});

clinicRouter.get("/appointments", requireAuth, async (request, response) => {
  const options = listOptions(request.query, { time: "a.starts_at", doctor: "d.full_name", patient: "u.full_name", status: "a.status" }, "time");
  const values = [];
  const filters = ["1 = 1"];
  if (request.user.role === "patient") {
    values.push(request.user.id);
    filters.push(`a.patient_id = $${values.length}`);
  } else if (request.user.role === "doctor") {
    values.push(request.user.id);
    filters.push(`d.staff_user_id = $${values.length}`);
  } else if (request.query.patientId && isUuid(request.query.patientId)) {
    values.push(request.query.patientId);
    filters.push(`a.patient_id = $${values.length}`);
  }
  if (request.query.from) {
    values.push(request.query.from);
    filters.push(`a.starts_at >= $${values.length}::timestamptz`);
  }
  if (request.query.to) {
    values.push(request.query.to);
    filters.push(`a.starts_at < $${values.length}::timestamptz`);
  }
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM appointments a JOIN users u ON u.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id WHERE ${filters.join(" AND ")}`,
    values
  );
  const total = totalResult.rows[0].total;
  const result = await pool.query(
    `SELECT a.id, a.starts_at AS "startsAt", a.status,
            u.full_name AS "patientName", u.phone AS "patientPhone",
            d.id AS "doctorId", d.full_name AS "doctorName",
            b.id AS "branchId", b.name AS "branchName", b.address AS "branchAddress",
            s.id AS "serviceId", s.name AS "serviceName", s.price_kzt AS "priceKzt"
     FROM appointments a
     JOIN users u ON u.id = a.patient_id
     JOIN doctors d ON d.id = a.doctor_id
     JOIN branches b ON b.id = a.branch_id
     LEFT JOIN services s ON s.id = a.service_id
     WHERE ${filters.join(" AND ")}
     ORDER BY ${options.sort} ${options.direction}
     LIMIT ${options.limit} OFFSET ${options.offset}`,
    values
  );
  response.json({ data: result.rows, pagination: { page: options.page, limit: options.limit, total, pages: Math.ceil(total / options.limit) } });
});

clinicRouter.get("/appointments/:id", requireAuth, async (request, response) => {
  if (!isUuid(request.params.id)) throw apiError(400, "Invalid appointment id.");
  const result = await pool.query(
    `SELECT a.id, a.patient_id, a.starts_at AS "startsAt", a.status,
            u.full_name AS "patientName", u.phone AS "patientPhone",
            d.id AS "doctorId", d.full_name AS "doctorName", d.staff_user_id AS "doctorUserId",
            b.id AS "branchId", b.name AS "branchName", b.address AS "branchAddress",
            s.id AS "serviceId", s.name AS "serviceName", s.price_kzt AS "priceKzt"
     FROM appointments a
     JOIN users u ON u.id = a.patient_id
     JOIN doctors d ON d.id = a.doctor_id
     JOIN branches b ON b.id = a.branch_id
     LEFT JOIN services s ON s.id = a.service_id
     WHERE a.id = $1`,
    [request.params.id]
  );
  const appointment = result.rows[0];
  if (!appointment) throw apiError(404, "Appointment not found.");
  const allowed = request.user.role === "admin" ||
    (request.user.role === "patient" && appointment.patient_id === request.user.id) ||
    (request.user.role === "doctor" && appointment.doctorUserId === request.user.id);
  if (!allowed) throw apiError(403, "You cannot view this appointment.");
  delete appointment.patient_id;
  delete appointment.doctorUserId;
  response.json({ data: appointment });
});

clinicRouter.post("/appointments", requireAuth, requireRole("patient"), async (request, response) => {
  const { doctorId, branchId, serviceId = null, startsAt } = request.body;
  if (!isUuid(doctorId) || !isUuid(branchId) || (serviceId && !isUuid(serviceId))) {
    throw apiError(400, "Choose a valid doctor, branch, and service.");
  }
  if (!validAppointmentTime(startsAt)) throw apiError(400, "Choose a future date and time with a timezone.");
  const available = await slotIsAvailable({ doctorId, branchId, serviceId, startsAt });
  if (!available) throw apiError(409, "This doctor has no available time at the selected branch.");
  try {
    const result = await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, branch_id, service_id, starts_at, duration_minutes)
       VALUES ($1, $2, $3, $4, $5::timestamptz,
               COALESCE((SELECT duration_minutes FROM services WHERE id = $4), 30))
       RETURNING id, doctor_id AS "doctorId", branch_id AS "branchId",
                 service_id AS "serviceId", starts_at AS "startsAt", duration_minutes AS "durationMinutes", status`,
      [request.user.id, doctorId, branchId, serviceId, startsAt]
    );
    response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (isConflict(error)) throw apiError(409, "This time has already been booked.");
    throw error;
  }
});

clinicRouter.patch("/appointments/:id", requireAuth, async (request, response) => {
  if (!isUuid(request.params.id)) throw apiError(400, "Invalid appointment id.");
  const current = await pool.query(
    "SELECT a.id, a.patient_id, a.doctor_id, a.branch_id, a.service_id, a.status, d.staff_user_id FROM appointments a JOIN doctors d ON d.id = a.doctor_id WHERE a.id = $1",
    [request.params.id]
  );
  const appointment = current.rows[0];
  if (!appointment) throw apiError(404, "Appointment not found.");
  const patientOwns = request.user.role === "patient" && appointment.patient_id === request.user.id;
  const doctorOwns = request.user.role === "doctor" && appointment.staff_user_id === request.user.id;
  const admin = request.user.role === "admin";

  if (request.body.status === "cancelled" && (patientOwns || doctorOwns || admin)) {
    const result = await pool.query(
      "UPDATE appointments SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'booked' RETURNING id, starts_at AS \"startsAt\", status",
      [appointment.id]
    );
    if (!result.rowCount) throw apiError(409, "Only booked appointments can be cancelled.");
    return response.json({ data: result.rows[0] });
  }

  if (request.body.status === "completed" && (doctorOwns || admin)) {
    const result = await pool.query(
      "UPDATE appointments SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'booked' RETURNING id, starts_at AS \"startsAt\", status",
      [appointment.id]
    );
    if (!result.rowCount) throw apiError(409, "Only booked appointments can be completed.");
    return response.json({ data: result.rows[0] });
  }

  if (request.body.startsAt && (patientOwns || admin)) {
    if (appointment.status !== "booked") throw apiError(409, "Only booked appointments can be rescheduled.");
    if (!validAppointmentTime(request.body.startsAt)) throw apiError(400, "Choose a future date and time with a timezone.");
    const available = await slotIsAvailable({
      doctorId: appointment.doctor_id,
      branchId: appointment.branch_id,
      serviceId: appointment.service_id,
      startsAt: request.body.startsAt,
      excludeAppointmentId: appointment.id
    });
    if (!available) throw apiError(409, "This doctor has no available time at the selected branch.");
    try {
      const result = await pool.query(
        "UPDATE appointments SET starts_at = $1::timestamptz, updated_at = NOW() WHERE id = $2 AND status = 'booked' RETURNING id, starts_at AS \"startsAt\", status",
        [request.body.startsAt, appointment.id]
      );
      return response.json({ data: result.rows[0] });
    } catch (error) {
      if (isConflict(error)) throw apiError(409, "This time has already been booked.");
      throw error;
    }
  }

  throw apiError(403, "This action is not allowed for your role.");
});

clinicRouter.post("/admin/staff", requireAuth, requireRole("admin"), async (request, response) => {
  const fullName = typeof request.body.fullName === "string" ? request.body.fullName.trim() : "";
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";
  const doctorId = request.body.doctorId || null;
  if (fullName.length < 2 || fullName.length > 120) throw apiError(400, "Full name must contain 2 to 120 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw apiError(400, "Enter a valid email address.");
  if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72) throw apiError(400, "Password must be at least 10 characters and no more than 72 bytes.");
  if (doctorId && !isUuid(doctorId)) throw apiError(400, "Invalid doctor id.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await client.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'doctor') RETURNING id, full_name, email, role",
      [fullName, email, passwordHash]
    );
    if (doctorId) {
      const link = await client.query(
        "UPDATE doctors SET staff_user_id = $1, updated_at = NOW() WHERE id = $2 AND staff_user_id IS NULL RETURNING id",
        [user.rows[0].id, doctorId]
      );
      if (!link.rowCount) throw apiError(409, "Doctor profile not found or already linked to a staff account.");
    }
    await client.query("COMMIT");
    response.status(201).json({ data: { id: user.rows[0].id, fullName, email, role: "doctor" } });
  } catch (error) {
    await client.query("ROLLBACK");
    if (isConflict(error)) throw apiError(409, "An account with this email already exists.");
    throw error;
  } finally {
    client.release();
  }
});

clinicRouter.post("/admin/doctors", requireAuth, requireRole("admin"), async (request, response) => {
  const { code, fullName, specialty, description = "", experienceYears = 0 } = request.body;
  if (![code, fullName, specialty].every((value) => typeof value === "string" && value.trim())) {
    throw apiError(400, "Code, full name, and specialty are required.");
  }
  if (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 60) {
    throw apiError(400, "Experience years must be between 0 and 60.");
  }
  try {
    const result = await pool.query(
      "INSERT INTO doctors (public_code, full_name, specialty, description, experience_years) VALUES ($1, $2, $3, $4, $5) RETURNING id, public_code AS code, full_name AS \"fullName\", specialty, description, experience_years AS \"experienceYears\"",
      [code.trim().toLowerCase(), fullName.trim(), specialty.trim(), String(description).slice(0, 1000), experienceYears]
    );
    response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (isConflict(error)) throw apiError(409, "A doctor with this code already exists.");
    throw error;
  }
});

clinicRouter.patch("/admin/doctors/:id", requireAuth, requireRole("admin"), async (request, response) => {
  await updateAdminRecord(request, response, "doctors", {
    fullName: "full_name", specialty: "specialty", description: "description", experienceYears: "experience_years"
  }, true);
});
clinicRouter.delete("/admin/doctors/:id", requireAuth, requireRole("admin"), async (request, response) => {
  await deactivateRecord(request, response, "doctors");
});

clinicRouter.post("/admin/branches", requireAuth, requireRole("admin"), async (request, response) => {
  const { code, name, address, mapUrl = null } = request.body;
  if (![code, name, address].every((value) => typeof value === "string" && value.trim())) {
    throw apiError(400, "Code, name, and address are required.");
  }
  try {
    const result = await pool.query(
      "INSERT INTO branches (public_code, name, address, map_url) VALUES ($1, $2, $3, $4) RETURNING id, public_code AS code, name, address, map_url AS \"mapUrl\"",
      [code.trim().toLowerCase(), name.trim(), address.trim(), mapUrl]
    );
    response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (isConflict(error)) throw apiError(409, "A branch with this code already exists.");
    throw error;
  }
});
clinicRouter.patch("/admin/branches/:id", requireAuth, requireRole("admin"), async (request, response) => {
  await updateAdminRecord(request, response, "branches", { name: "name", address: "address", mapUrl: "map_url" }, false);
});
clinicRouter.delete("/admin/branches/:id", requireAuth, requireRole("admin"), async (request, response) => {
  await deactivateRecord(request, response, "branches");
});

clinicRouter.post("/admin/services", requireAuth, requireRole("admin"), async (request, response) => {
  const { code, name, priceKzt, durationMinutes } = request.body;
  if (![code, name].every((value) => typeof value === "string" && value.trim())) throw apiError(400, "Code and name are required.");
  if (!Number.isInteger(priceKzt) || priceKzt < 0 || !Number.isInteger(durationMinutes) || durationMinutes < 1) {
    throw apiError(400, "Price and duration must be valid positive numbers.");
  }
  try {
    const result = await pool.query(
      "INSERT INTO services (public_code, name, price_kzt, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING id, public_code AS code, name, price_kzt AS \"priceKzt\", duration_minutes AS \"durationMinutes\"",
      [code.trim().toLowerCase(), name.trim(), priceKzt, durationMinutes]
    );
    response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (isConflict(error)) throw apiError(409, "A service with this code already exists.");
    throw error;
  }
});
clinicRouter.patch("/admin/services/:id", requireAuth, requireRole("admin"), async (request, response) => {
  await updateAdminRecord(request, response, "services", { name: "name", priceKzt: "price_kzt", durationMinutes: "duration_minutes" }, false);
});
clinicRouter.delete("/admin/services/:id", requireAuth, requireRole("admin"), async (request, response) => {
  await deactivateRecord(request, response, "services");
});

clinicRouter.get("/admin/schedules", requireAuth, requireRole("admin"), async (_request, response) => {
  const result = await pool.query(
    `SELECT ds.id, ds.doctor_id AS "doctorId", d.full_name AS "doctorName",
            ds.branch_id AS "branchId", b.name AS "branchName", ds.weekday,
            ds.starts_at AS "startsAt", ds.ends_at AS "endsAt",
            ds.slot_minutes AS "slotMinutes", ds.is_active AS "isActive"
     FROM doctor_schedules ds
     JOIN doctors d ON d.id = ds.doctor_id
     JOIN branches b ON b.id = ds.branch_id
     WHERE ds.is_active = TRUE
     ORDER BY d.full_name, ds.weekday, ds.starts_at`
  );
  response.json({ data: result.rows });
});

clinicRouter.post("/admin/schedules", requireAuth, requireRole("admin"), async (request, response) => {
  const { doctorId, branchId, weekday, startsAt, endsAt, slotMinutes = 30 } = request.body;
  if (!isUuid(doctorId) || !isUuid(branchId) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw apiError(400, "Choose a valid doctor, branch, and weekday.");
  }
  if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(startsAt || "") ||
      !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(endsAt || "") || startsAt >= endsAt) {
    throw apiError(400, "Enter valid working hours.");
  }
  if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 240) {
    throw apiError(400, "Slot length must be between 5 and 240 minutes.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO doctor_branches (doctor_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [doctorId, branchId]
    );
    const result = await client.query(
      `INSERT INTO doctor_schedules (doctor_id, branch_id, weekday, starts_at, ends_at, slot_minutes)
       VALUES ($1, $2, $3, $4::time, $5::time, $6)
       ON CONFLICT (doctor_id, branch_id, weekday) DO UPDATE
         SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
             slot_minutes = EXCLUDED.slot_minutes, is_active = TRUE
       RETURNING id, doctor_id AS "doctorId", branch_id AS "branchId", weekday,
                 starts_at AS "startsAt", ends_at AS "endsAt", slot_minutes AS "slotMinutes", is_active AS "isActive"`,
      [doctorId, branchId, weekday, startsAt, endsAt, slotMinutes]
    );
    await client.query("COMMIT");
    response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

clinicRouter.patch("/admin/schedules/:id", requireAuth, requireRole("admin"), async (request, response) => {
  if (!isUuid(request.params.id)) throw apiError(400, "Invalid schedule id.");
  const current = await pool.query("SELECT starts_at, ends_at, slot_minutes, is_active FROM doctor_schedules WHERE id = $1", [request.params.id]);
  if (!current.rowCount) throw apiError(404, "Schedule not found.");
  const startsAt = request.body.startsAt ?? String(current.rows[0].starts_at).slice(0, 5);
  const endsAt = request.body.endsAt ?? String(current.rows[0].ends_at).slice(0, 5);
  const slotMinutes = request.body.slotMinutes ?? current.rows[0].slot_minutes;
  const isActive = request.body.isActive ?? current.rows[0].is_active;
  if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(startsAt) ||
      !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(endsAt) || startsAt >= endsAt ||
      !Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 240 ||
      typeof isActive !== "boolean") {
    throw apiError(400, "Provide valid schedule hours, slot length, and active state.");
  }
  const result = await pool.query(
    `UPDATE doctor_schedules
     SET starts_at = $1::time, ends_at = $2::time, slot_minutes = $3, is_active = $4
     WHERE id = $5
     RETURNING id, doctor_id AS "doctorId", branch_id AS "branchId", weekday,
               starts_at AS "startsAt", ends_at AS "endsAt", slot_minutes AS "slotMinutes", is_active AS "isActive"`,
    [startsAt, endsAt, slotMinutes, isActive, request.params.id]
  );
  response.json({ data: result.rows[0] });
});

clinicRouter.delete("/admin/schedules/:id", requireAuth, requireRole("admin"), async (request, response) => {
  if (!isUuid(request.params.id)) throw apiError(400, "Invalid schedule id.");
  const result = await pool.query("UPDATE doctor_schedules SET is_active = FALSE WHERE id = $1 AND is_active = TRUE RETURNING id", [request.params.id]);
  if (!result.rowCount) throw apiError(404, "Active schedule not found.");
  response.json({ data: { id: result.rows[0].id, deactivated: true } });
});

async function updateAdminRecord(request, response, table, allowedFields, hasUpdatedAt) {
  if (!isUuid(request.params.id)) throw apiError(400, "Invalid record id.");
  const fields = Object.entries(allowedFields)
    .filter(([key]) => Object.hasOwn(request.body, key));
  if (!fields.length) throw apiError(400, "Provide at least one field to update.");
  const values = fields.map(([key]) => request.body[key]);
  const assignments = fields.map(([key], index) => `${allowedFields[key]} = $${index + 1}`);
  if (hasUpdatedAt) assignments.push("updated_at = NOW()");
  values.push(request.params.id);
  const result = await pool.query(
    `UPDATE ${table} SET ${assignments.join(", ")} WHERE id = $${values.length} AND is_active = TRUE RETURNING id`,
    values
  );
  if (!result.rowCount) throw apiError(404, "Active record not found.");
  response.json({ data: { id: result.rows[0].id, updated: true } });
}

async function deactivateRecord(request, response, table) {
  if (!isUuid(request.params.id)) throw apiError(400, "Invalid record id.");
  const result = await pool.query(
    `UPDATE ${table} SET is_active = FALSE WHERE id = $1 AND is_active = TRUE RETURNING id`,
    [request.params.id]
  );
  if (!result.rowCount) throw apiError(404, "Active record not found.");
  response.json({ data: { id: result.rows[0].id, deactivated: true } });
}
