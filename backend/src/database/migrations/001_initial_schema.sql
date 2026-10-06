-- Initial schema, aligned with the SRS. IDs are UUID strings (TEXT).
-- Timestamps are ISO-8601 UTC strings.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,   -- services must lowercase/trim before insert and lookup
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE courses (
  id          TEXT PRIMARY KEY,
  course_code TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  teacher_id  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE enrollments (
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE attendance_sessions (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  otp_code   TEXT NOT NULL CHECK (length(otp_code) = 6 AND otp_code NOT GLOB '*[^0-9]*'),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at   TEXT
);

CREATE TABLE attendance_records (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  punched_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (session_id, student_id),          -- one punch per student per session
  UNIQUE (session_id, device_fingerprint)   -- one device per session (anti-proxy)
);

CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title       TEXT NOT NULL,
  description TEXT,
  file_path   TEXT NOT NULL,   -- generated storage name, relative to UPLOAD_DIR
  file_size   INTEGER NOT NULL CHECK (file_size >= 0),
  mime_type   TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE assessments (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  max_marks  REAL NOT NULL CHECK (max_marks > 0),
  weightage  REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE student_marks (
  assessment_id  TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marks_obtained REAL NOT NULL CHECK (marks_obtained >= 0),
  feedback       TEXT,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (assessment_id, student_id)
);

-- Indexes. The PRIMARY KEY / UNIQUE constraints above already index
-- enrollments(course_id, student_id), attendance_records(session_id, student_id)
-- and student_marks(assessment_id, student_id).
CREATE INDEX idx_courses_teacher        ON courses(teacher_id);
CREATE INDEX idx_enrollments_student    ON enrollments(student_id);
CREATE INDEX idx_sessions_course_active ON attendance_sessions(course_id, is_active);
CREATE INDEX idx_records_student        ON attendance_records(student_id);
CREATE INDEX idx_documents_course       ON documents(course_id);
CREATE INDEX idx_assessments_course     ON assessments(course_id);
CREATE INDEX idx_marks_student          ON student_marks(student_id);
