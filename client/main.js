const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  kids: [], gear: [], boss: null, battle: null, inventory: []
};

const ICONS_SVG = {
  weapon: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
    <rect width="48" height="48" fill="#0b1220"/>
    <rect x="6" y="30" width="30" height="6" fill="#d1d5db"/>
    <rect x="36" y="24" width="6" height="18" fill="#fca5a5"/>
  </svg>`,
  armor: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
    <rect width="48" height="48" fill="#0b1220"/>
    <rect x="10" y="8" width="28" height="12" fill="#6ee7b7"/>
    <rect x="14" y="20" width="20" height="20" fill="#22c55e"/>
  </svg>`,
  accessory: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
    <rect width="48" height="48" fill="#0b1220"/>
    <circle cx="24" cy="24" r="10" fill="#fbbf24"/>
    <rect x="22" y="6" width="4" height="8" fill="#fde68a"/>
  </svg>`
};

function setAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  renderNav(); route();
}

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  renderNav(); route();
}

async function api(path, opts={}) {
  const res = await fetch(`${window.API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type':'application/json',
      ...(state.token ? {'Authorization':`Bearer ${state.token}`} : {}),
      ...(opts.headers || {}),
    }
  });
  const ct = res.headers.get('content-type')||'';
  const body = ct.includes('application/json') ? await res.json().catch(()=>({})) : await res.text();
  if (!res.ok) throw new Error((body && body.error) ? body.error : (typeof body==='string'?body:`HTTP ${res.status}`));
  return body;
}

/* ---------------- NAV ---------------- */
function renderNav() {
  const nav = document.getElementById('nav');
  if (!state.token) {
    nav.innerHTML = '<button onclick="showLogin()">Login</button><button onclick="showRegister()">Register</button>';
    return;
  }
  const links = [];
  if (state.user.role === 'kid') {
    links.push(`<a href="#/kid" class="${location.hash==='#/kid'?'active':''}">My Dashboard</a>`);
    links.push(`<a href="#/shop" class="${location.hash==='#/shop'?'active':''}">Shop & Gear</a>`);
  } else {
    links.push(`<a href="#/parent" class="${location.hash==='#/parent'?'active':''}">Parent Dashboard</a>`);
    links.push(`<a href="#/boss" class="${location.hash==='#/boss'?'active':''}">Boss Control</a>`);
  }
  links.push(`<button onclick="logout()">Logout</button>`);
  nav.innerHTML = links.join('');
}

function route() {
  if (!state.token) return showLogin();
  if (state.user.role === 'kid') {
    if (location.hash === '#/shop') return showShop();
    return showKid();
  } else {
    if (location.hash === '#/boss') return showBossControl();
    return showParent();
  }
}

window.addEventListener('hashchange', route);
function htmlesc(s){return s? s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '';}

/* ---------------- AUTH VIEWS ---------------- */
function showLogin() {
  const v = document.getElementById('view');
  v.innerHTML = `
    <div class="card">
      <h2>Login</h2>
      <div class="grid">
        <input id="email" class="input" placeholder="Email" />
        <input id="password" type="password" class="input" placeholder="Password" />
        <button class="btn primary" onclick="doLogin()">Login</button>
      </div>
      <div class="small">Demo users: parent@example.com / password123, theo@example.com / password123, mia@example.com / password123</div>
    </div>
  `;
}
async function doLogin() {
  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const res = await api('/auth/login',{ method:'POST', body: JSON.stringify({email,password}) });
    setAuth(res.token, res.user);
  } catch (e) { alert(e.message); }
}

function showRegister() {
  const v = document.getElementById('view');
  v.innerHTML = `
    <div class="card">
      <h2>Register (Kid or Parent)</h2>
      <div class="grid">
        <input id="r_name" class="input" placeholder="Name" />
        <input id="r_email" class="input" placeholder="Email" />
        <input id="r_password" type="password" class="input" placeholder="Password" />
        <select id="r_role" class="input">
          <option value="kid">Kid</option>
          <option value="parent">Parent</option>
        </select>
        <select id="r_class" class="input">
          <option value="">(Class for Kids)</option>
          <option value="mage">Mage</option>
          <option value="warrior">Warrior</option>
          <option value="thief">Thief</option>
          <option value="archer">Archer</option>
        </select>
        <button class="btn primary" onclick="doRegister()">Create Account</button>
      </div>
    </div>
  `;
}
async function doRegister() {
  try {
    const payload = {
      name: document.getElementById('r_name').value.trim(),
      email: document.getElementById('r_email').value.trim(),
      password: document.getElementById('r_password').value,
      role: document.getElementById('r_role').value,
      class: document.getElementById('r_class').value || null,
    };
    await api('/auth/register', { method:'POST', body: JSON.stringify(payload) });
    alert('Account created. Please login.');
    location.hash = '#'; showLogin();
  } catch (e) { alert(e.message); }
}

/* ---------------- KID DASHBOARD ---------------- */
async function showKid() {
  const v = document.getElementById('view');
  const me = await api('/me');
  state.user = { ...state.user, ...me };
  const boss = await api('/boss/current').catch(()=>null);
  state.boss = boss?.boss || null;
  state.battle = boss?.battle || null;
  const inv = await api('/inventory').catch(()=>[]);
  state.inventory = inv;

  const equipped = { weapon:null, armor:null, accessory:null };
  for (const it of inv) if (it.equipped) equipped[it.slot] = it;

  v.innerHTML = `
    <div class="card">
      <h2>Welcome, ${htmlesc(me.name)}</h2>
      <div class="grid">
        <div class="card">
          <h3>Stats</h3>
          <div class="small">Class: ${htmlesc(me.class||'-')}</div>
          <div>Level: ${me.level} | XP: ${me.xp}</div>
          <div>HP: ${me.hp} | ATK: ${me.attack} | DEF: ${me.defense} | SPD: ${me.speed}</div>
          <div>Coins: ${Number(me.coins).toFixed(2)}</div>
        </div>
        <div class="card">
          <h3>Equipped Gear</h3>
          <div class="grid">
            ${['weapon','armor','accessory'].map(slot=>{
              const it = equipped[slot];
              return `<div class="gear-row">
                <div class="pixel" aria-label="${slot}">${ICONS_SVG[slot]}</div>
                <div>
                  <div><strong>${slot.toUpperCase()}</strong></div>
                  <div class="small">${it? htmlesc(it.name)+' ('+htmlesc(it.rarity)+')' : 'None equipped'}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Boss</h3>
      ${(state.boss) ? `
        <div>${htmlesc(state.boss.name)} [${htmlesc(state.boss.tier)}] — HP: ${state.boss.hp}</div>
        <div class="small">Battle ID: ${state.battle?.id || '-'}</div>
        <div class="grid">
          <button class="btn primary" onclick="joinBattle()">Join Battle</button>
        </div>
      ` : '<div class="small">No boss set for this week yet.</div>'}
    </div>
  `;
}

/* ---------------- SHOP & INVENTORY ---------------- */
async function showShop() {
  const v = document.getElementById('view');
  const me = await api('/me');
  const gear = await api('/gear');
  const inv  = await api('/inventory').catch(()=>[]);
  state.gear = gear;
  state.inventory = inv;

  // id -> owned item (with equipped flag)
  const owned = new Map(inv.map(i => [i.id, i]));

  v.innerHTML = `
    <div class="card">
      <h2>Shop & Gear</h2>
      <div class="small">Coins: ${Number(me.coins).toFixed(2)}</div>
      <div class="grid">
        ${gear.map(g => {
          const mine = owned.get(g.id);
          const buttons = mine
            ? (mine.equipped
                ? `<button class="btn"        onclick="unequip(${g.id})">Unequip</button>`
                : `<button class="btn primary" onclick="equip(${g.id})">Equip</button>`)
            : `<button class="btn" onclick="buyGear(${g.id})">Buy (${Number(g.cost).toFixed(2)})</button>`;

          // NOTE: all references use g.slot (not 'slot')
          const iconSvg = (ICONS_SVG[g.slot] || '');

          return `
            <div class="card">
              <div class="gear-row">
                <div class="pixel" aria-label="${g.slot}">${iconSvg}</div>
                <div>
                  <div><strong>${htmlesc(g.name)}</strong> <span class="small">(${g.rarity})</span></div>
                  <div class="small">Slot: ${g.slot} | Cost: ${Number(g.cost).toFixed(2)}</div>
                  <div class="small">+ATK ${g.attack_bonus} | +DEF ${g.defense_bonus} | +SPD ${g.speed_bonus} | +HP ${g.hp_bonus}</div>
                </div>
              </div>
              <div style="margin-top:8px;">${buttons}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}
async function buyGear(id) {
  try { await api('/shop/buy',{ method:'POST', body: JSON.stringify({ gear_id: id }) }); alert('Purchased!'); showShop(); }
  catch(e){ alert(e.message); }
}
async function equip(id) {
  try { await api('/inventory/equip',{ method:'POST', body: JSON.stringify({ gear_id: id }) }); alert('Equipped!'); showShop(); }
  catch(e){ alert(e.message); }
}
async function unequip(id) {
  try { await api('/inventory/unequip',{ method:'POST', body: JSON.stringify({ gear_id: id }) }); alert('Unequipped.'); showShop(); }
  catch(e){ alert(e.message); }
}

/* ---------------- PARENT & BOSS ---------------- */
async function showParent() {
  const v = document.getElementById('view');
  const kids = await api('/kids');
  state.kids = kids;
  const week_start = (() => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
  v.innerHTML = `
    <div class="card">
      <h2>Parent Dashboard</h2>
      <div class="small">Week starting: ${week_start}</div>
      <table>
        <thead><tr><th>Name</th><th>Class</th><th>Lvl</th><th>XP</th><th>HP</th><th>ATK</th><th>DEF</th><th>SPD</th><th>Coins</th><th>Points (0–30)</th><th></th></tr></thead>
        <tbody>
          ${kids.map(k=>`<tr>
            <td>${htmlesc(k.name)}</td><td>${htmlesc(k.class||'-')}</td><td>${k.level}</td><td>${k.xp}</td><td>${k.hp}</td><td>${k.attack}</td><td>${k.defense}</td><td>${k.speed}</td>
            <td>${Number(k.coins).toFixed(2)}</td>
            <td><input id="pts_${k.user_id}" class="input" type="number" min="0" max="30" value="0" /></td>
            <td><button class="btn" onclick="setPoints(${k.user_id}, '${week_start}')">Save</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}
async function setPoints(userId, week_start) {
  try { const val = parseInt(document.getElementById(`pts_${userId}`).value,10);
    await api('/chores/admin-set', { method:'POST', body: JSON.stringify({ user_id:userId, week_start, points: val }) });
    alert('Saved!'); showParent();
  } catch (e) { alert(e.message); }
}

async function showBossControl() {
  const v = document.getElementById('view');

  // fetch current boss+battle
  let bc = null;
  try { bc = await api('/boss/current'); } catch {}
  state.boss = bc?.boss || null;
  state.battle = bc?.battle || null;

  v.innerHTML = `
    <div class="card">
      <h2>Boss Control (Parent)</h2>
      <div class="grid">
        <input id="b_name" class="input" placeholder="Boss name" />
        <select id="b_tier" class="input">
          <option value="mid">Mid</option>
          <option value="standard">Standard</option>
          <option value="epic">Epic</option>
        </select>
        <input id="b_hp" class="input" type="number" placeholder="HP" />
        <input id="b_atk" class="input" type="number" placeholder="Attack bonus" />
        <input id="b_dmin" class="input" type="number" placeholder="Damage min" />
        <input id="b_dmax" class="input" type="number" placeholder="Damage max" />
        <button class="btn primary" onclick="setBoss()">Set This Week's Boss</button>
      </div>
      <div class="small">Current: ${state.boss ? `${state.boss.name} [${state.boss.tier}] HP ${state.boss.hp}` : 'None'}</div>
    </div>

    <div class="card">
      <h3>Battle Controls</h3>
      <div class="grid">
        ${state.battle
          ? `<button class="btn primary" onclick="openParentBattle()">Open Battle Room</button>`
          : `<button class="btn primary" onclick="createAndOpenBattle()">Create & Open Battle</button>`}
        <button class="btn" onclick="resolveBattle()">Distribute Loot</button>
      </div>
      <div class="small">Battle ID: ${state.battle?.id ?? '-'}</div>
    </div>
  `;
}

// Open existing battle room; parent will see “Start battle (parent)”
function openParentBattle() {
  if (!state.battle) { alert('No active battle.'); return; }
  joinBattle();
}

// Create a boss for this week then open the battle room
async function createAndOpenBattle() {
  try {
    const week_start = (() => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
    const payload = {
      name: document.getElementById('b_name')?.value || 'Weekly Boss',
      tier: document.getElementById('b_tier')?.value || 'standard',
      hp: parseInt(document.getElementById('b_hp')?.value || '500', 10),
      attack_bonus: parseInt(document.getElementById('b_atk')?.value || '2', 10),
      damage_min: parseInt(document.getElementById('b_dmin')?.value || '1', 10),
      damage_max: parseInt(document.getElementById('b_dmax')?.value || '6', 10),
      abilities: [],
      week_start,
    };
    const res = await api('/boss/set', { method:'POST', body: JSON.stringify(payload) });
    state.boss = res.boss;
    state.battle = res.battle;
    openParentBattle();
  } catch (e) {
    alert(e.message || 'Failed to create battle.');
  }
}

async function setBoss() {
  try {
    const week_start = (()=>{const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10);})();
    const payload = {
      name: document.getElementById('b_name').value || 'Unknown Foe',
      tier: document.getElementById('b_tier').value,
      hp: parseInt(document.getElementById('b_hp').value||'0',10),
      attack_bonus: parseInt(document.getElementById('b_atk').value||'0',10),
      damage_min: parseInt(document.getElementById('b_dmin').value||'0',10),
      damage_max: parseInt(document.getElementById('b_dmax').value||'0',10),
      abilities: [], week_start,
    };
    await api('/boss/set',{ method:'POST', body: JSON.stringify(payload) });
    alert('Boss set for this week!'); showBossControl();
  } catch (e) { alert(e.message); }
}
async function resolveBattle() {
  try {
    if (!state.battle) return alert('No active battle to resolve');
    const res = await api('/boss/resolve',{ method:'POST', body: JSON.stringify({ battle_id: state.battle.id }) });
    alert(`Loot distributed! Total coin pot: ${res.totalCoins}`); showBossControl();
  } catch (e) { alert(e.message); }
}

/* -------- Real-time Battle Client -------- */
/* -------- Real-time Battle Client -------- */
let battleSocket = null;
let battleState = null;

function showBattleRoom() {
  const v = document.getElementById('view');
  if (!battleState) { v.innerHTML = '<div class="card">Connecting…</div>'; return; }
  const meId = state.user.id;
  const participants = Object.values(battleState.participants || {});
  const orderDisplay = (battleState.order || []).map(id => {
    const p = battleState.participants[id];
    return p ? `${p.name}${(id===meId)?' (you)':''}` : id;
  }).join(' → ');

  v.innerHTML = `
    <div class="card">
      <h2>Battle – ${battleState.status.toUpperCase()}</h2>
      <div>Round: ${battleState.round || 0}</div>
      <div class="small">Turn order: ${orderDisplay || '-'}</div>
      <div class="grid">
        ${participants.map(p=>`
          <div class="card">
            <strong>${htmlesc(p.name)}${p.userId===meId?' (you)':''}</strong>
            <div>HP: ${p.hp}</div>
            <div>ATK: ${p.attack} | DEF: ${p.defense} | SPD: ${p.speed}</div>
            <div class="small">${p.connected?'🟢 online':'⚫ offline'} ${p.ready?'• ready':''}</div>
            ${p.last ? `<div class="small">Last: ${p.last.type}${p.last.dmg?(' '+p.last.dmg):''}${p.last.roll?(' (roll '+p.last.roll+')'):''}</div>` : ''}
          </div>
        `).join('')}
      </div>

      ${battleState.status==='lobby' ? `
        <button class="btn primary" onclick="battleReady()">I am ready</button>
        ${state.user.role!=='kid' ? `<button class="btn" onclick="battleStart()">Start battle (parent)</button>`:''}
        <button class="btn" onclick="leaveBattle()">Leave</button>
      ` : ''}

      ${battleState.status==='active' ? `
        <div class="card">
          <h3>Your actions</h3>
          <button class="btn primary" onclick="battleAction('attack')">Attack</button>
          <button class="btn" onclick="battleAction('defend')">Defend</button>
          <button class="btn" onclick="leaveBattle()">Leave</button>
        </div>
      ` : ''}
    </div>
  `;
}

function joinBattle() {
  if (!state.battle) { alert('No active battle ID.'); return; }

  // Use API_BASE; allow websocket or polling fallback
  battleSocket = io(`${window.API_BASE}/battle`, {
    transports: ['websocket','polling'],
    timeout: 20000
  });

  battleSocket.on('connect', () => {
    // Join then immediately ask for state so we never miss the first broadcast
    battleSocket.emit('join', {
      battleId: state.battle.id,
      tokenUser: { id: state.user.id, name: state.user.name, role: state.user.role }
    });
    battleSocket.emit('get');
  });

  battleSocket.on('state', (s) => {
    battleState = s;
    showBattleRoom();
  });

  battleSocket.on('connect_error', (err) => {
    alert(`Battle connection failed: ${err?.message || err}`);
    route();
  });

  battleSocket.on('error', (err) => {
    console.warn('battle socket error:', err);
  });

  showBattleRoom();
}

function battleReady(){ battleSocket?.emit('ready'); }
function battleStart(){ battleSocket?.emit('start'); }
function battleAction(type){ battleSocket?.emit('action', { type }); }
function leaveBattle(){ try{ battleSocket?.disconnect(); }catch{}; battleSocket=null; battleState=null; route(); }


// Boot
renderNav(); route();
