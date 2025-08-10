import { Server } from 'socket.io';
import { pool } from './db.js';

export function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET','POST'] }
  });

  const battles = new Map();
  const room = id => `battle_${id}`;
  const emit = (id) => io.to(room(id)).emit('state', battles.get(id));

  io.of('/battle').on('connection', (socket) => {
    socket.on('join', async ({ battleId, tokenUser }) => {
      if (!battleId || !tokenUser) return;
      socket.join(room(battleId));

      if (!battles.has(battleId)) {
        const br = await pool.query('select * from battles where id=$1', [battleId]);
        if (!br.rows[0]) return;
        battles.set(battleId, {
          battleId, status: 'lobby', round: 0, turnIndex: 0,
          participants: {}, order: []
        });
      }
      const s = battles.get(battleId);
      if (!s.participants[tokenUser.id]) {
        const ur = await pool.query('select id,name,hp,attack,defense,speed from users where id=$1',[tokenUser.id]);
        const u = ur.rows[0];
        s.participants[tokenUser.id] = {
          userId: u.id, name: u.name, hp: u.hp, attack: u.attack, defense: u.defense, speed: u.speed,
          ready: false, connected: true
        };
      } else {
        s.participants[tokenUser.id].connected = true;
      }
      socket.data.battleId = battleId;
      socket.data.userId = tokenUser.id;
      emit(battleId);
    });

    socket.on('ready', () => {
      const { battleId, userId } = socket.data || {};
      if (!battles.has(battleId)) return;
      const s = battles.get(battleId);
      if (!s.participants[userId]) return;
      s.participants[userId].ready = true;
      emit(battleId);
    });

    socket.on('start', () => {
      const { battleId } = socket.data || {};
      if (!battles.has(battleId)) return;
      const s = battles.get(battleId);
      if (s.status !== 'lobby') return;
      s.status = 'active';
      s.round = 1;
      s.order = Object.values(s.participants).sort((a,b)=>b.speed-a.speed).map(p=>p.userId);
      s.turnIndex = 0;
      emit(battleId);
    });

    socket.on('action', ({ type }) => {
      const { battleId, userId } = socket.data || {};
      if (!battles.has(battleId)) return;
      const s = battles.get(battleId);
      if (s.status !== 'active') return;
      const current = s.order[s.turnIndex];
      if (current !== userId) return;

      if (type === 'attack') {
        const attacker = s.participants[userId];
        const roll = Math.floor(Math.random()*20)+1;
        const dmg = Math.max(1, attacker.attack + Math.floor(roll/10));
        attacker.last = { type, roll, dmg };
        pool.query(
          `insert into battle_contributions (battle_id,user_id,damage)
           values ($1,$2,$3)
           on conflict (battle_id,user_id) do update set damage=battle_contributions.damage + EXCLUDED.damage`,
          [battleId, userId, dmg]
        ).catch(()=>{});
      } else if (type === 'defend') {
        const p = s.participants[userId];
        p.last = { type };
      }

      s.turnIndex = (s.turnIndex + 1) % s.order.length;
      if (s.turnIndex === 0) s.round += 1;
      emit(battleId);
    });

    socket.on('disconnect', () => {
      const { battleId, userId } = socket.data || {};
      if (!battleId || !battles.has(battleId) || !userId) return;
      const s = battles.get(battleId);
      if (s.participants[userId]) s.participants[userId].connected = false;
      emit(battleId);
    });
  });
}