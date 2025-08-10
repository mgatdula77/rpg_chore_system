import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { requireAuth, requireRole } from './authMiddleware.js';
import http from 'http';
import { initRealtime } from './realtime.js';

dotenv.config();
const app = express();
// CORS FIRST — allow your client + local dev and the Authorization header
app.use(cors({
  origin: [
    'https://rpg-chore-client.onrender.com', // your live frontend
    'http://localhost:3000'                  // local dev (optional)
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Helmet AFTER CORS — disable CORP so cross-origin XHR is allowed
app.use(helmet({
  crossOriginResourcePolicy: false,
}));

// JSON parser
app.use(express.json());


const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

/* ---------------- AUTH ---------------- */
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, role='kid', class: clazz=null } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'insert into users (role,name,email,password_hash,class) values ($1,$2,$3,$4,$5) returning id, role, name, email, class',
      [role, name, email, hash, clazz]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Register failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await pool.query('select * from users where email=$1', [email]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, role: user.role, name: user.name, class: user.class }});
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/me', requireAuth, async (req, res) => {
  const r = await pool.query('select id, role, name, email, class, level, xp, hp, attack, defense, speed, coins from users where id=$1', [req.user.id]);
  res.json(r.rows[0]);
});

/* ---------------- INVENTORY ---------------- */
app.get('/inventory', requireAuth, requireRole('kid'), async (req, res) => {
  const r = await pool.query(`
    select g.*, ug.equipped
    from user_gear ug
    join gear g on g.id = ug.gear_id
    where ug.user_id = $1
    order by g.slot, g.cost
  `, [req.user.id]);
  res.json(r.rows);
});

app.post('/inventory/equip', requireAuth, requireRole('kid'), async (req, res) => {
  const { gear_id } = req.body;
  const gr = await pool.query('select * from gear where id=$1', [gear_id]);
  const g = gr.rows[0];
  if (!g) return res.status(404).json({ error: 'Gear not found' });
  const own = await pool.query('select * from user_gear where user_id=$1 and gear_id=$2', [req.user.id, gear_id]);
  if (!own.rows[0]) return res.status(400).json({ error: 'You do not own this item' });

  await pool.query('begin');
  // Unequip any other item in same slot
  const current = await pool.query(`
    select g.*, ug.equipped from user_gear ug join gear g on g.id=ug.gear_id
    where ug.user_id=$1 and ug.equipped=true and g.slot=$2
  `, [req.user.id, g.slot]);
  if (current.rows[0]) {
    const c = current.rows[0];
    await pool.query('update user_gear set equipped=false where user_id=$1 and gear_id=$2', [req.user.id, c.id]);
    await pool.query('update users set attack=attack-$1, defense=defense-$2, speed=speed-$3, hp=hp-$4 where id=$5',
      [c.attack_bonus, c.defense_bonus, c.speed_bonus, c.hp_bonus, req.user.id]);
  }
  // Equip new
  await pool.query('update user_gear set equipped=true where user_id=$1 and gear_id=$2', [req.user.id, gear_id]);
  await pool.query('update users set attack=attack+$1, defense=defense+$2, speed=speed+$3, hp=hp+$4 where id=$5',
    [g.attack_bonus, g.defense_bonus, g.speed_bonus, g.hp_bonus, req.user.id]);
  await pool.query('commit');
  res.json({ ok: true });
});

app.post('/inventory/unequip', requireAuth, requireRole('kid'), async (req, res) => {
  const { gear_id } = req.body;
  const gr = await pool.query('select * from gear where id=$1', [gear_id]);
  const g = gr.rows[0];
  if (!g) return res.status(404).json({ error: 'Gear not found' });
  const ug = await pool.query('select equipped from user_gear where user_id=$1 and gear_id=$2', [req.user.id, gear_id]);
  if (!ug.rows[0] || !ug.rows[0].equipped) return res.status(400).json({ error: 'Not equipped' });

  await pool.query('begin');
  await pool.query('update user_gear set equipped=false where user_id=$1 and gear_id=$2', [req.user.id, gear_id]);
  await pool.query('update users set attack=attack-$1, defense=defense-$2, speed=speed-$3, hp=hp-$4 where id=$5',
    [g.attack_bonus, g.defense_bonus, g.speed_bonus, g.hp_bonus, req.user.id]);
  await pool.query('commit');
  res.json({ ok: true });
});

/* ---------------- KIDS & PARENTS ---------------- */
app.get('/kids', requireAuth, requireRole('parent','admin'), async (req, res) => {
  const r = await pool.query('select * from kid_summary order by name');
  res.json(r.rows);
});

app.post('/chores/admin-set', requireAuth, requireRole('parent','admin'), async (req, res) => {
  try {
    const { user_id, week_start, points } = req.body;
    if (!user_id || points == null || !week_start) return res.status(400).json({ error: 'Missing fields' });
    if (points < 0 || points > 30) return res.status(400).json({ error: 'Points out of range' });
    const xp = points * 100;
    const coins = Number(points).toFixed(2);
    await pool.query('begin');
    await pool.query(`
      insert into chores (user_id, week_start, points, xp_awarded, coins_awarded)
      values ($1,$2,$3,$4,$5)
      on conflict (user_id, week_start) do update set points=excluded.points, xp_awarded=excluded.xp_awarded, coins_awarded=excluded.coins_awarded
    `,[user_id, week_start, points, xp, coins]);
    await pool.query(
      `update users set xp = (select coalesce(sum(xp_awarded),0) from chores where user_id=$1),
                       coins = (select coalesce(sum(coins_awarded),0) from chores where user_id=$1)
       where id=$1`,
      [user_id]
    );
    await pool.query('commit');
    res.json({ ok: true, xp, coins: Number(coins) });
  } catch (e) {
    await pool.query('rollback');
    console.error(e);
    res.status(500).json({ error: 'Admin set failed' });
  }
});

/* ---------------- GEAR & SHOP ---------------- */
app.get('/gear', requireAuth, async (req, res) => {
  const r = await pool.query('select * from gear order by cost asc');
  res.json(r.rows);
});

app.post('/shop/buy', requireAuth, requireRole('kid'), async (req, res) => {
  try {
    const { gear_id } = req.body;
    const gr = await pool.query('select * from gear where id=$1', [gear_id]);
    const g = gr.rows[0];
    if (!g) return res.status(404).json({ error: 'Gear not found' });
    if (!g.purchasable) return res.status(400).json({ error: 'Not purchasable' });
    const ur = await pool.query('select coins from users where id=$1', [req.user.id]);
    const coins = Number(ur.rows[0].coins);
    if (coins < Number(g.cost)) return res.status(400).json({ error: 'Insufficient coins' });

    const newCoins = (coins - Number(g.cost)).toFixed(2);
    await pool.query('begin');
    await pool.query('update users set coins=$1 where id=$2', [newCoins, req.user.id]);
    await pool.query('insert into user_gear (user_id, gear_id) values ($1,$2) on conflict do nothing', [req.user.id, gear_id]);
    await pool.query('commit');
    res.json({ ok: true, newBalance: Number(newCoins) });
  } catch (e) {
    await pool.query('rollback');
    console.error(e);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

/* ---------------- BOSS & BATTLES ---------------- */
app.post('/boss/set', requireAuth, requireRole('parent','admin'), async (req, res) => {
  const { name, tier, hp, attack_bonus, damage_min, damage_max, abilities=[], week_start } = req.body;
  if (!name || !tier || !hp || !week_start) return res.status(400).json({ error: 'Missing fields' });
  const r = await pool.query(
    `insert into bosses (name,tier,hp,attack_bonus,damage_min,damage_max,abilities,week_start)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (week_start) do update set name=excluded.name, tier=excluded.tier, hp=excluded.hp, attack_bonus=excluded.attack_bonus, damage_min=excluded.damage_min, damage_max=excluded.damage_max, abilities=excluded.abilities
     returning *`,
    [name,tier,hp,attack_bonus,damage_min,damage_max,JSON.stringify(abilities),week_start]
  );
  const br = await pool.query('insert into battles (boss_id,total_damage,resolved) values ($1,0,false) returning *', [r.rows[0].id]);
  res.json({ boss: r.rows[0], battle: br.rows[0] });
});

app.get('/boss/current', requireAuth, async (req, res) => {
  const today = new Date();
  const week_start = new Date(today); week_start.setDate(week_start.getDate() - week_start.getDay());
  const r = await pool.query('select * from bosses where week_start=$1', [week_start.toISOString().slice(0,10)]);
  if (!r.rows[0]) return res.json(null);
  const boss = r.rows[0];
  const br = await pool.query('select * from battles where boss_id=$1', [boss.id]);
  res.json({ boss, battle: br.rows[0] });
});

app.post('/boss/resolve', requireAuth, requireRole('parent','admin'), async (req, res) => {
  const { battle_id } = req.body;
  const br = await pool.query('select * from battles b join bosses s on b.boss_id = s.id where b.id=$1', [battle_id]);
  const row = br.rows[0];
  if (!row) return res.status(404).json({ error: 'Battle not found' });
  if (row.resolved) return res.status(400).json({ error: 'Already resolved' });

  const lootConfig = {
    mid: { coins: [10,20], rareChance: 0.05, realWorldChance: 0.01 },
    standard: { coins: [20,35], rareChance: 0.12, realWorldChance: 0.02 },
    epic: { coins: [30,50], rareChance: 0.20, realWorldChance: 0.05 },
  };
  const cfg = lootConfig[row.tier] || lootConfig.standard;
  const randInt = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const chance = (p)=>Math.random()<p;
  const totalCoins = randInt(cfg.coins[0], cfg.coins[1]);

  const cr = await pool.query('select user_id, damage from battle_contributions where battle_id=$1', [battle_id]);
  const contribs = cr.rows;
  const sumDamage = contribs.reduce((s,c)=>s+c.damage,0) || 1;

  for (const c of contribs) {
    const share = Number(totalCoins * (c.damage / sumDamage)).toFixed(2);
    const cur = await pool.query('select coins from users where id=$1', [c.user_id]);
    const newBal = (Number(cur.rows[0].coins) + Number(share)).toFixed(2);
    await pool.query('update users set coins=$1 where id=$2', [newBal, c.user_id]);
  }

  const gearRows = await pool.query("select id from gear where rarity in ('rare','legendary')");
  const gearIds = gearRows.rows.map(r=>r.id);
  for (const c of contribs) {
    if (chance(cfg.rareChance) && gearIds.length) {
      const gid = gearIds[randInt(0, gearIds.length-1)];
      await pool.query('insert into user_gear (user_id, gear_id) values ($1,$2) on conflict do nothing', [c.user_id, gid]);
    }
  }

  await pool.query('update battles set resolved=true where id=$1', [battle_id]);
  res.json({ ok: true, totalCoins, participants: contribs.length });
});

app.get('/', (_req,res)=>res.send('Chore RPG API running'));

const server = http.createServer(app);
initRealtime(server);
server.listen(PORT, ()=>console.log(`API on :${PORT}`));
