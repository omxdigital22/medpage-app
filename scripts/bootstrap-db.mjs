import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, "../lib/db/package.json"));
const pg = require("pg");
const envPath = resolve(__dirname, "../.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const url = env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set in .env");
  process.exit(1);
}

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar UNIQUE,
  first_name varchar,
  last_name varchar,
  profile_image_url varchar,
  password_hash varchar,
  auth_provider varchar NOT NULL DEFAULT 'replit',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  sid varchar PRIMARY KEY,
  sess jsonb NOT NULL,
  expire timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire);

CREATE TABLE IF NOT EXISTS study_sessions (
  id varchar PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar NOT NULL,
  mode varchar NOT NULL DEFAULT 'longAnswer',
  language varchar NOT NULL DEFAULT 'English',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_files (
  id varchar PRIMARY KEY,
  study_session_id varchar NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id varchar NOT NULL,
  name varchar NOT NULL,
  file_type varchar NOT NULL,
  page_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id varchar PRIMARY KEY,
  study_session_id varchar NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id varchar NOT NULL,
  role varchar NOT NULL,
  content text NOT NULL,
  citation_page integer,
  citation_quote text,
  source_name varchar,
  cross_questions jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_answers (
  id varchar PRIMARY KEY,
  study_session_id varchar NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id varchar NOT NULL,
  topic varchar NOT NULL,
  sections jsonb NOT NULL,
  citations jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(sql);
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log("Schema ready. Tables:", rows.map((r) => r.table_name).join(", "));
} finally {
  await pool.end();
}
