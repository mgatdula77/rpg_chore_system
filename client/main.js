const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  kids: [],
  gear: [],
  boss: null,
  battle: null,
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
  const r = await fetch(`${window.API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type':'application/json',
      ...(state.token ? {'Authorization':`Bearer ${state.token}`} : {}),
      ...(opts.headers || {}),
    }
  });
  if (!r.ok) { throw new Error((await r.json()).error || 'Request failed'); }
  return r.json();
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
    links.push(`<a href="#/shop" class="${location.hash==='#/shop'?'active':''}">Shop</a>`);
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

/* ---------------- VIEWS ---------------- */
function htmlesc(s){return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

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
      <div class="small">Demo users after seeding: parent@example.com / password123, theo@example.com / password123, mia@example.com / password123</div>
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
    location.hash = '#';
    showLogin();
  } catch (e) { alert(e.message); }
}

async function showKid() {
  const v = document.getElementById('view');
  const me = await api('/me');
  state.user = { ...state.user, ...me };
  const boss = await api('/boss/current').catch(()=>null);
  state.boss = boss?.boss || null;
  state.battle = boss?.battle || null;
  v.innerHTML = `
    <div class="card">
      <h2>Welcome, ${htmlesc(me.name)}</h2>
      <div class="grid">
        <div class="card">
          <h3>Stats</h3>
          <div class="small">Class: ${htmlesc(me.class||'-')}</div>
          <div>Level: ${me.level} | XP: ${me.xp}</div>
          <div>HP: ${me.hp} | ATK: ${me.attack} | DEF: ${me.defense} | SPD: ${me.speed}</div>
          <div>Coins: ${me.coins}</div>
        </div>
        <div class="card">
          <h3>Submit Weekly Chores (0–30)</h3>
          <input id="points" class="input" type="number" min="0" max="30" value="0" />
          <button class="btn primary" onclick="submitChores()">Submit</button>
          <div class="small">1 point = 100 XP + 1 coin.</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Boss</h3>
      ${(state.boss) ? `
        <div>${htmlesc(state.boss.name)} [${htmlesc(state.boss.tier)}] — HP: ${state.boss.hp}</div>
        <div class="small">Battle ID: ${state.battle?.id || '-'}</div>
        <div class="grid">
          <input id="damage" class="input" type="number" min="0" placeholder="Enter your damage contribution" />
          <button class="btn primary" onclick="recordDamage()">Record Damage</button>
        </div>
      ` : '<div class="small">No boss set for this week yet.</div>'}
    </div>
  `;
}

async function submitChores() {
  try {
    const points = parseInt(document.getElementById('points').value, 10);
    const week_start = new Date(); week_start.setDate(week_start.getDate() - week_start.getDay());
    const payload = { week_start: week_start.toISOString().slice(0,10), points };
    await api('/chores/submit', { method:'POST', body: JSON.stringify(payload) });
    alert('Submitted! XP and coins added.');
    showKid();
  } catch (e) { alert(e.message); }
}

async function recordDamage() {
  try {
    if (!state.battle) return alert('No active battle.');
    const damage = parseInt(document.getElementById('damage').value, 10);
    await api('/boss/record-damage', { method:'POST', body: JSON.stringify({ battle_id: state.battle.id, damage }) });
    alert('Damage recorded!');
  } catch (e) { alert(e.message); }
}

async function showShop() {
  const v = document.getElementById('view');
  const me = await api('/me');
  const gear = await api('/gear');
  state.gear = gear;
  v.innerHTML = `
    <div class="card">
      <h2>Shop</h2>
      <div class="small">Coins: ${me.coins}</div>
      <div class="grid">
      ${gear.map(g=>`
        <div class="card">
          <div><strong>${htmlesc(g.name)}</strong> <span class="small">(${g.rarity})</span></div>
          <div class="small">Slot: ${g.slot}</div>
          <div class="small">Cost: ${g.cost}</div>
          <div class="small">+ATK ${g.attack_bonus} | +DEF ${g.defense_bonus} | +SPD ${g.speed_bonus} | +HP ${g.hp_bonus}</div>
          <button class="btn" onclick="buyGear(${g.id})">Buy</button>
        </div>
      `).join('')}
      </div>
    </div>
  `;
}

async function buyGear(id) {
  try {
    await api('/shop/buy',{ method:'POST', body: JSON.stringify({ gear_id: id }) });
    alert('Purchased! Stats updated.');
    showShop();
  } catch (e) { alert(e.message); }
}

async function showParent() {
  const v = document.getElementById('view');
  const kids = await api('/kids');
  state.kids = kids;
  v.innerHTML = `
    <div class="card">
      <h2>Parent Dashboard</h2>
      <table>
        <thead><tr><th>Name</th><th>Class</th><th>Lvl</th><th>XP</th><th>HP</th><th>ATK</th><th>DEF</th><th>SPD</th><th>Coins</th></tr></thead>
        <tbody>
          ${kids.map(k=>`<tr><td>${htmlesc(k.name)}</td><td>${htmlesc(k.class||'-')}</td><td>${k.level}</td><td>${k.xp}</td><td>${k.hp}</td><td>${k.attack}</td><td>${k.defense}</td><td>${k.speed}</td><td>${k.coins}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function showBossControl() {
  const v = document.getElementById('view');
  const boss = await api('/boss/current').catch(()=>null);
  state.boss = boss?.boss || null;
  state.battle = boss?.battle || null;
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
      <div class="small">Current: ${(state.boss)? state.boss.name+' ['+state.boss.tier+'] HP '+state.boss.hp : 'None'}</div>
    </div>
    <div class="card">
      <h3>Resolve Battle</h3>
      <div class="grid">
        <button class="btn primary" onclick="resolveBattle()">Distribute Loot</button>
      </div>
      <div class="small">Battle ID: ${state.battle?.id || '-'}</div>
    </div>
  `;
}

async function setBoss() {
  try {
    const today = new Date();
    const week_start = new Date(today); week_start.setDate(week_start.getDate() - week_start.getDay());
    const payload = {
      name: document.getElementById('b_name').value || 'Unknown Foe',
      tier: document.getElementById('b_tier').value,
      hp: parseInt(document.getElementById('b_hp').value||'0',10),
      attack_bonus: parseInt(document.getElementById('b_atk').value||'0',10),
      damage_min: parseInt(document.getElementById('b_dmin').value||'0',10),
      damage_max: parseInt(document.getElementById('b_dmax').value||'0',10),
      abilities: [],
      week_start: week_start.toISOString().slice(0,10),
    };
    await api('/boss/set',{ method:'POST', body: JSON.stringify(payload) });
    alert('Boss set for this week!');
    showBossControl();
  } catch (e) { alert(e.message); }
}

async function resolveBattle() {
  try {
    if (!state.battle) return alert('No active battle to resolve');
    const res = await api('/boss/resolve',{ method:'POST', body: JSON.stringify({ battle_id: state.battle.id }) });
    alert(`Loot distributed! Total coin pot: ${res.totalCoins}`);
    showBossControl();
  } catch (e) { alert(e.message); }
}

// Boot
renderNav(); route();