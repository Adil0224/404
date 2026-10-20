import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db.js";

try {
  for (const file of ["db/schema.sql", "db/seed.sql"]) {
    const sql = await readFile(new URL("../" + file, import.meta.url), "utf8");
    await pool.query(sql);
    console.log(JSON.stringify({ level: "info", event: "database_script_completed", file }));
  }
} catch (error) {
  console.error(JSON.stringify({ level: "error", event: "database_init_failed", message: error.message }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
