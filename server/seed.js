import { pool } from './db.js';
import bcrypt from 'bcrypt';

async function run() {
  await pool.query((await (await fetch(new URL('./schema.sql', import.meta.url))).text()));
}

// Fallback if fetch fails in some envs: read file from fs
import fs from 'fs';
import path from 'path';
const schemaPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
async function runFS() {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  // Seed sample gear
  await pool.query(`
    insert into gear (name, slot, rarity, cost, attack_bonus, description) values
    ('Wooden Sword','weapon','common',10,1,'Starter blade'),
    ('Hunter Bow','weapon','common',12,1,'Simple bow'),
    ('Leather Armor','armor','common',12,1, 'Light armor'),
    ('Iron Shield','armor','uncommon',20,2,'Adds defense'),
    ('Ring of Quickness','accessory','uncommon',25,0, 'Speed ring')
  on conflict do nothing;
  `);

  // Create a parent admin and two kids
  const pw = await bcrypt.hash('password123', 10);
  await pool.query(
    `insert into users (role, name, email, password_hash) values
     ('parent','Parent One','parent@example.com',$1),
     ('kid','Theo','theo@example.com',$1),
     ('kid','Mia','mia@example.com',$1)
     on conflict do nothing;`, [pw]
  );
  console.log('Schema + seed completed.');
}

runFS().then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)});