// src/migrate.ts
import { readdir } from "node:fs/promises";
import { sql } from "./db";

await sql`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`;

const rows: { name: string }[] = await sql`select name from schema_migrations`;
const applied = new Set(rows.map((row) => row.name));
const files = (await readdir("migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  if (applied.has(file)) {
    continue;
  }
  const text = await Bun.file(`migrations/${file}`).text();
  await sql.begin(async (tx) => {
    await tx.unsafe(text);
    await tx`insert into schema_migrations (name) values (${file})`;
  });
  console.log(`applied ${file}`);
}

await sql.close();
