// server/realtime.js
import { Server } from 'socket.io';
import { pool } from './db.js';

export function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    // CORS must allow your client
    cors: {
      origin: [
        'https://rpg-chore-client.onrender.com',
        'http://localhost:3000'
      ],
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization']
    },
    // avoid premature disconnects on cold starts
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // in-memory room states
  const battles = new Map();
  const ns = io.of('/battle');

  const room = id => `battle_${id}`;
  const emit = id => {
    const state = battles.get(id);
    if (state) ns.to(room(id)).emit('state', state);
  };

  // Utility: ensure battle state exists (lazy load from DB)
  async function ensureBattle(battleId) {
    if (battles.has(battleId)) return battles.get(battleId);
    const br = await pool.query('select * from battles where id=$1', [battleId]);
    if (!br.rows[0]) return null;

    const state = {
      battleId,
      status: 'lobby',      // 'lobby' | 'active' | 'ended'
      round: 0,
      turnIndex: 0,
      participants: {},     // userId -> {userId,name,hp,attack,defense,speed,ready,connected,last}
      order: []             // array of userIds (speed-sorted)
    };
    battles.set(battleId, state);
    return state;
  }

  ns.on('connection', (socket) => {
    // Basic visibility into failures
    socket.on('error', (err) => {
      console.warn('socket error:', err?.message || err);
    });
    socket.on('connect_error', (err) => {
      console.warn('connect_error:', err?.message || err);
    });

    socket.on('join', async ({ battleId, tokenUser }) => {
      try {
        if (!battleId || !tokenUser?.id) return;
        const state = await ensureBattle(battleId);
        if (!state) return;

        socket.join(room(battleId));
        socket.data.battleId = battleId;
        socket.data.userId = tokenUser.id;

        // hydrate participant
        if (!state.participants[tokenUser.id]) {
          const ur = await pool.query(
            'select id,name,hp,attack,defense,speed from users where id=$1',
            [tokenUser.id]
          );
          const u = ur.rows[0];
          if (!u) return;
          state.participants[u.id] = {
            userId: u.id, name: u.name, hp: u.hp, attack: u.attack,
            defense: u.defense, speed: u.speed, ready: false, connected: true, last: null
          };
        } else {
          state.participants[tokenUser.id].connected = true;
        }

        // immediately send full state so the UI never “hangs”
        emit(battleId);
      } catch (e) {
        console.error('join error', e);
      }
    });

    socket.on('get', () => {
      const { battleId } = socket.data || {};
      if (battleId) emit(battleId);
    });

    socket.on('ready', () => {
      const { battleId, userId } = socket.data || {};
      const s = battles.get(battleId); if (!s) return;
      if (s.participants[userId]) s.participants[userId].ready = true;
      emit(battleId);
    });

    socket.on('start', () => {
      const { battleId } = socket.data || {};
      const s = battles.get(battleId); if (!s) return;
      if (s.status !== 'lobby') return;
      // sort by speed desc; ties stable
      s.order = Object.values(s.participants).sort((a,b)=>b.speed-a.speed).map(p=>p.userId);
      s.turnIndex = 0;
      s.round = 1;
      s.status = 'active';
      emit(battleId);
    });

    socket.on('action', async ({ type }) => {
      const { battleId, userId } = socket.data || {};
      const s = battles.get(battleId); if (!s) return;
      if (s.status !== 'active') return;

      const current = s.order[s.turnIndex];
      if (current !== userId) return; // not your turn

      if (type === 'attack') {
        const p = s.participants[userId];
        const roll = Math.floor(Math.random()*20)+1;
        const dmg = Math.max(1, p.attack + Math.floor(roll/10));
        p.last = { type: 'attack', roll, dmg };

        // persist damage contribution
        try {
          await pool.query(
            `insert into battle_contributions (battle_id,user_id,damage)
             values ($1,$2,$3)
             on conflict (battle_id,user_id)
             do update set damage = battle_contributions.damage + EXCLUDED.damage`,
            [battleId, userId, dmg]
          );
        } catch (e) {
          console.error('record damage failed', e);
        }
      } else if (type === 'defend') {
        s.participants[userId].last = { type: 'defend' };
      }

      // advance turn
      s.turnIndex = (s.turnIndex + 1) % s.order.length;
      if (s.turnIndex === 0) s.round += 1;

      emit(battleId);
    });

    socket.on('disconnect', () => {
      const { battleId, userId } = socket.data || {};
      const s = battles.get(battleId); if (!s) return;
      if (s.participants[userId]) s.participants[userId].connected = false;
      emit(battleId);
    });
  });
}
