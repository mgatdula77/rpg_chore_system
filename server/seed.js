import { pool } from './db.js';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

async function run() {
  const schemaPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);

  await pool.query(`
    insert into gear (name, slot, rarity, cost, attack_bonus, defense_bonus, speed_bonus, hp_bonus, purchasable, description) values
    ('Wooden Sword','weapon','common',10.00,1,0,0,0,true,'Starter blade'),
    ('Hunter Bow','weapon','common',12.00,1,0,0,0,true,'Simple bow'),
    ('Leather Armor','armor','common',12.00,0,1,0,0,true,'Light armor'),
    ('Iron Shield','armor','uncommon',20.00,0,2,0,0,true,'Adds defense'),
    ('Ring of Quickness','accessory','uncommon',25.00,0,0,1,0,true,'Speed ring')
  on conflict do nothing;
  `);

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

run().then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)});