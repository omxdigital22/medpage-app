import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireDb = createRequire(resolve(__dirname, "../lib/db/package.json"));
const requireApi = createRequire(resolve(__dirname, "../artifacts/api-server/package.json"));
const pg = requireDb("pg");
const bcrypt = requireApi("bcryptjs");

const DEMO_EMAIL = "demo@medpager.app";
const DEMO_PASSWORD = "MedPager2026!";

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

const pool = new pg.Pool({ connectionString: url });
try {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password_hash, auth_provider)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       password_hash = EXCLUDED.password_hash,
       auth_provider = EXCLUDED.auth_provider,
       updated_at = now()
     RETURNING id, email, first_name, last_name`,
    [DEMO_EMAIL, "Demo", "User", passwordHash, "email"],
  );
  const user = rows[0];
  console.log(`Demo user ready: ${user.email} (${user.id})`);
} finally {
  await pool.end();
}
