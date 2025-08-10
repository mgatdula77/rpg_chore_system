# Chore RPG – D&D‑Inspired Weekly Boss System

A minimal full‑stack starter you can deploy to **Render** and manage via **GitHub**.

- Backend: Node.js + Express + PostgreSQL (`pg`)
- Frontend: Vanilla JS SPA (no React) for simplicity
- Auth: JWT (localStorage), roles: **kid**, **parent**, **admin**
- Game rules aligned to your system: **1 point = 100 XP** and **1 point = 1 coin** (max 30 points/week/child)

---

## Quick Start (Local)

### 1) Database
Create a Postgres DB (locally or in Docker). Then set `server/.env`:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/chore_rpg
JWT_SECRET=change_me
PORT=4000
```

### 2) API
```
cd server
npm i
node seed.js   # creates tables + sample data
npm run dev
```

### 3) Client
In a separate terminal:
```
cd client
npm i
npm start
```
Open http://localhost:3000

**Demo users after seeding:**
- Parent: `parent@example.com` / `password123`
- Kids: `theo@example.com` / `password123`, `mia@example.com` / `password123`

---

## Deploy to Render

1. Push this folder to a **GitHub** repo.
2. Create a **Render PostgreSQL** instance (copy the connection string).
3. Create a **Render Web Service** for `server/`:
   - Runtime: Node
   - Build command: `npm i`
   - Start command: `node server.js`
   - Env Vars:
     - `DATABASE_URL` = your Render Postgres URL
     - `JWT_SECRET` = a strong secret
     - `PORT` = `10000` (Render assigns `$PORT`, Express reads it)
4. Create a **Render Static Site** for `client/` (or another Web Service using `serve`):
   - If Static Site, set the API base in `client/index.html` to your API host.
   - If Web Service:
     - Build: `npm i`
     - Start: `npm start`

**Note:** For HTTPS on Render Postgres, SSL is automatically enabled via code (`rejectUnauthorized:false`).

---

## Key API Endpoints

- `POST /auth/register` – create account (kid/parent)
- `POST /auth/login` – login, returns JWT
- `GET /me` – current user profile
- `GET /kids` – parent view of all kids (stats)
- `POST /chores/submit` – kid submits weekly points (0..30) → awards XP & coins
- `GET /gear` – list gear
- `POST /shop/buy` – purchase gear (applies stat bonuses)
- `POST /boss/set` – parent sets this week’s boss (fixed stats by tier)
- `GET /boss/current` – get this week’s boss + battle id
- `POST /boss/record-damage` – kid records their contribution for the week
- `POST /boss/resolve` – parent distributes loot (coins + rare gear chance by tier)

---

## Design Notes

- **Points → Rewards**: 1 point = **100 XP** + **1 coin**.
- **Boss Difficulty Not Auto‑Scaled**: Parent sets boss (mid/standard/epic) manually. Loot scales by tier.
- **Loot**: Coin pot distributed proportionally by damage. Each participant also rolls for rare gear; small chance for real‑world reward (parents adjudicate).

---

## Extend

- Add **level‑up** logic (auto +1 HP and +1 to a stat when crossing thresholds).
- Add **abilities** per class (mage/warrior/thief/archer) and use them during a weekly live fight.
- Add **audit logs** for parents and **weekly history** pages.
- Replace manual damage entry with computed damage from points + gear.
- Add email/password reset flows if needed.