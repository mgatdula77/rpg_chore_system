
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { requireAuth, requireRole } from './authMiddleware.js';

dotenv.config();
const app = express();
app.use(helmet());
app.use(cors());
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

/* ---------------- KIDS & PARENTS ---------------- */
app.get('/kids', requireAuth, requireRole('parent','admin'), async (req, res) => {
  const r = await pool.query('select * from kid_summary order by name');
  res.json(r.rows);
});

app.post('/chores/submit', requireAuth, requireRole('kid'), async (req, res) => {
  try {
    const { week_start, points } = req.body; // points 0..30
    if (points < 0 || points > 30) return res.status(400).json({ error: 'Points out of range' });
    const xp = points * 100;
    const coins = points * 1;
    await pool.query('begin');
    await pool.query(
      `insert into chores (user_id, week_start, points, xp_awarded, coins_awarded)
       values ($1,$2,$3,$4,$5)
       on conflict (user_id, week_start) do update set points = excluded.points, xp_awarded=excluded.xp_awarded, coins_awarded=excluded.coins_awarded`,
      [req.user.id, week_start, points, xp, coins]
    );
    await pool.query(
      `update users set xp = xp + $1, coins = coins + $2 where id=$3`,
      [xp, coins, req.user.id]
    );
    await pool.query('commit');
    res.json({ ok: true, xpGained: xp, coinsGained: coins });
  } catch (e) {
    await pool.query('rollback');
    console.error(e);
    res.status(500).json({ error: 'Submit failed' });
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
    const coins = ur.rows[0].coins;
    if (coins < g.cost) return res.status(400).json({ error: 'Insufficient coins' });

    await pool.query('begin');
    await pool.query('update users set coins=coins-$1, attack=attack+$2, defense=defense+$3, speed=speed+$4, hp=hp+$5 where id=$6',
      [g.cost, g.attack_bonus, g.defense_bonus, g.speed_bonus, g.hp_bonus, req.user.id]);
    await pool.query('insert into user_gear (user_id, gear_id) values ($1,$2) on conflict do nothing', [req.user.id, gear_id]);
    await pool.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await pool.query('rollback');
    console.error(e);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

/* ---------------- BOSS & BATTLES ---------------- */
// Parent sets the weekly boss with fixed stats (not scaled to players)
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
  // create or fetch battle
  const br = await pool.query('insert into battles (boss_id,total_damage,resolved) values ($1,0,false) returning *', [r.rows[0].id]);
  res.json({ boss: r.rows[0], battle: br.rows[0] });
});

app.get('/boss/current', requireAuth, async (req, res) => {
  const today = new Date();
  const week_start = new Date(today); week_start.setDate(week_start.getDate() - week_start.getDay()); // Sunday
  const r = await pool.query('select * from bosses where week_start=$1', [week_start.toISOString().slice(0,10)]);
  if (!r.rows[0]) return res.json(null);
  const boss = r.rows[0];
  const br = await pool.query('select * from battles where boss_id=$1', [boss.id]);
  res.json({ boss, battle: br.rows[0] });
});

// Kids record their damage (based on their chores & gear). You can define UI logic client-side.
app.post('/boss/record-damage', requireAuth, requireRole('kid'), async (req, res) => {
  const { battle_id, damage } = req.body;
  if (damage < 0) return res.status(400).json({ error: 'Bad damage' });
  await pool.query('begin');
  await pool.query('insert into battle_contributions (battle_id,user_id,damage) values ($1,$2,$3) on conflict (battle_id,user_id) do update set damage=excluded.damage', [battle_id, req.user.id, damage]);
  await pool.query('update battles set total_damage = (select coalesce(sum(damage),0) from battle_contributions where battle_id=$1) where id=$1', [battle_id]);
  await pool.query('commit');
  res.json({ ok: true });
});

// Parent resolves weekly battle and distributes loot based on difficulty tier
app.post('/boss/resolve', requireAuth, requireRole('parent','admin'), async (req, res) => {
  const { battle_id } = req.body;
  const br = await pool.query('select * from battles b join bosses s on b.boss_id = s.id where b.id=$1', [battle_id]);
  const row = br.rows[0];
  if (!row) return res.status(404).json({ error: 'Battle not found' });
  if (row.resolved) return res.status(400).json({ error: 'Already resolved' });

  // Define loot by tier
  const lootConfig = {
    mid: { coins: [10,20], rareChance: 0.05, realWorldChance: 0.01 },
    standard: { coins: [20,35], rareChance: 0.12, realWorldChance: 0.02 },
    epic: { coins: [30,50], rareChance: 0.2, realWorldChance: 0.05 },
  };
  const cfg = lootConfig[row.tier] || lootConfig.standard;

  // Random helper
  const randInt = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
  const chance = (p)=>Math.random()<p;

  // Total coin pot
  const totalCoins = randInt(cfg.coins[0], cfg.coins[1]);

  // Contributions
  const cr = await pool.query('select user_id, damage from battle_contributions where battle_id=$1', [battle_id]);
  const contribs = cr.rows;
  const sumDamage = contribs.reduce((s,c)=>s+c.damage,0) || 1;

  // Distribute coins proportionally
  for (const c of contribs) {
    const share = Math.floor(totalCoins * (c.damage / sumDamage));
    if (share>0) await pool.query('update users set coins=coins+$1 where id=$2', [share, c.user_id]);
  }

  // Rare gear drops (independent rolls per contributor)
  const gearRows = await pool.query("select id from gear where rarity in ('rare','legendary')");
  const gearIds = gearRows.rows.map(r=>r.id);
  for (const c of contribs) {
    if (chance(cfg.rareChance) && gearIds.length) {
      const gid = gearIds[randInt(0, gearIds.length-1)];
      await pool.query('insert into user_gear (user_id, gear_id) values ($1,$2) on conflict do nothing', [c.user_id, gid]);
    }
    // Real-world reward placeholder: record as a note in description (parents can honor it)
    if (chance(cfg.realWorldChance)) {
      await pool.query("update users set coins=coins+0 where id=$1", [c.user_id]); // no-op, placeholder
    }
  }

  await pool.query('update battles set resolved=true where id=$1', [battle_id]);
  res.json({ ok: true, totalCoins, participants: contribs.length });
});

/* -------------- HEALTH CHECK -------------- */
app.get('/', (_req,res)=>res.send('Chore RPG API running'));

app.listen(PORT, ()=>console.log(`API on :${PORT}`));
