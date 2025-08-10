-- v3 schema
create table if not exists users (
  id serial primary key,
  role text not null check (role in ('kid','parent','admin')),
  name text not null,
  email text unique not null,
  password_hash text not null,
  class text check (class in ('mage','warrior','thief','archer')),
  level int not null default 1,
  xp int not null default 0,
  hp int not null default 10,
  attack int not null default 1,
  defense int not null default 0,
  speed int not null default 0,
  coins numeric(12,2) not null default 0.00,
  created_at timestamptz not null default now()
);

create table if not exists gear (
  id serial primary key,
  name text not null,
  slot text not null check (slot in ('weapon','armor','accessory')),
  rarity text not null check (rarity in ('common','uncommon','rare','legendary')),
  cost numeric(12,2) not null,
  attack_bonus int not null default 0,
  defense_bonus int not null default 0,
  speed_bonus int not null default 0,
  hp_bonus int not null default 0,
  purchasable boolean not null default true,
  description text
);

create table if not exists user_gear (
  user_id int references users(id) on delete cascade,
  gear_id int references gear(id) on delete cascade,
  equipped boolean not null default false,
  primary key (user_id, gear_id)
);

create table if not exists bosses (
  id serial primary key,
  name text not null,
  tier text not null check (tier in ('mid','standard','epic')),
  hp int not null,
  attack_bonus int not null,
  damage_min int not null,
  damage_max int not null,
  abilities jsonb not null default '[]'::jsonb,
  week_start date not null unique
);

create table if not exists chores (
  id serial primary key,
  user_id int references users(id) on delete cascade,
  week_start date not null,
  points int not null check (points between 0 and 30),
  xp_awarded int not null,
  coins_awarded numeric(12,2) not null,
  unique (user_id, week_start)
);

create table if not exists battles (
  id serial primary key,
  boss_id int references bosses(id) on delete cascade,
  total_damage int not null default 0,
  resolved boolean not null default false
);

create table if not exists battle_contributions (
  id serial primary key,
  battle_id int references battles(id) on delete cascade,
  user_id int references users(id) on delete cascade,
  damage int not null,
  unique (battle_id, user_id)
);

create or replace view kid_summary as
select u.id as user_id, u.name, u.class, u.level, u.xp, u.hp, u.attack, u.defense, u.speed, u.coins
from users u
where role='kid';