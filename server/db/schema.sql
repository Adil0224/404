-- Ақниет емханасының бастапқы дерекқор схемасы.
-- Жеке медициналық диагноздар бұл жобалық модельге енгізілмейді.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE appointment_status AS ENUM ('booked', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(32) UNIQUE,
  email VARCHAR(254) UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'patient',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(240) NOT NULL,
  map_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code VARCHAR(40) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  specialty VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  experience_years SMALLINT NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
  staff_user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_branches (
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, branch_id)
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  price_kzt INTEGER NOT NULL CHECK (price_kzt >= 0),
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  slot_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (slot_minutes > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT schedule_time_order CHECK (ends_at > starts_at),
  CONSTRAINT doctor_schedule_unique UNIQUE (doctor_id, branch_id, weekday)
);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 240),
  status appointment_status NOT NULL DEFAULT 'booked',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT appointment_start_in_future CHECK (starts_at > created_at)
);

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS doctor_time_unique;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes SMALLINT NOT NULL DEFAULT 30
  CHECK (duration_minutes BETWEEN 5 AND 240);
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointment_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, starts_at + make_interval(mins => duration_minutes), '[)') WITH &&
  ) WHERE (status = 'booked');

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body VARCHAR(1200) NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_expiry_idx
  ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS doctor_schedules_lookup_idx
  ON doctor_schedules (doctor_id, branch_id, weekday, is_active);
CREATE INDEX IF NOT EXISTS appointments_patient_start_idx
  ON appointments (patient_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS appointments_doctor_start_idx
  ON appointments (doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_branch_start_idx
  ON appointments (branch_id, starts_at);
CREATE INDEX IF NOT EXISTS doctors_specialty_idx
  ON doctors (specialty);
CREATE INDEX IF NOT EXISTS reviews_published_created_idx
  ON reviews (is_published, created_at DESC);
