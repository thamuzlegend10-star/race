/* Aurora GP online add-on: room-code multiplayer (PeerJS, host-relay) + touch/UI fixes.
   Needs: PeerJS script before this file, and window.G exposed by index.html. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const COL = ['#5eead4', '#ff6fb5', '#ffc94a', '#a78bfa'];
  const NAMES = ['Teal', 'Pink', 'Gold', 'Violet'];
  const PFX = 'aurora-gp-', ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  // TURN relay: lets players on different networks connect. For best reach, make a free
  // account at metered.ca, create an app, and paste its app name and API key here.
  const METERED_APP = '', METERED_KEY = '';
  const OR = { username: 'openrelayproject', credential: 'openrelayproject' };
  const BASE_ICE = [
    { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', ...OR }, { urls: 'turn:openrelay.metered.ca:443', ...OR },
    { urls: 'turns:openrelay.metered.ca:443?transport=tcp', ...OR },
  ];
  let iceCache = null;
  async function getIce() {
    if (iceCache) return iceCache;
    if (METERED_APP && METERED_KEY) {
      try {
        const r = await fetch(`https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_KEY}`);
        if (r.ok) return (iceCache = await r.json());
      } catch (e) {}
    }
    return (iceCache = BASE_ICE);
  }
  const mkPeer = async (id) => { const config = { iceServers: await getIce() }; return id ? new Peer(id, { config }) : new Peer({ config }); };

  // ---- UI fixes: readable text, toast under reduced motion, allow pinch zoom ----
  const st = document.createElement('style');
  st.textContent = `.card span{font-size:.78rem}.nl{font-size:.75rem}.tk span{font-size:.78rem}
@keyframes tf{0%,85%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion: reduce){#toast.show{animation:tf 1.5s forwards}}
button:disabled{opacity:.5;cursor:not-allowed;filter:none}
.code{font-size:2.4rem;font-weight:900;letter-spacing:.25em;text-align:center;margin:.2rem 0 .8rem}
.inp{width:100%;font:inherit;font-size:1.6rem;font-weight:800;letter-spacing:.25em;text-align:center;text-transform:uppercase;padding:.6rem;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.08);color:var(--ink);margin:.8rem 0}
.plist{list-style:none;padding:0;margin:0 0 1rem}.plist li{display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--line)}
.msg{min-height:1.3em;color:var(--muted);margin:.8rem 0 0}.row{display:flex;gap:8px;flex-wrap:wrap}`;
  document.head.appendChild(st);
  const vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';

  // ---- touch: handbrake + pause buttons ----
  const tc = $('#touch');
  const fire = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key }));
  const racing = () => window.G && (G.state === 'race' || G.state === 'countdown');
  if (tc) {
    const hb = document.createElement('button');
    hb.className = 'tb'; hb.textContent = 'H'; hb.setAttribute('aria-label', 'Handbrake');
    hb.style.cssText = 'right:calc(14px + 5.2rem);bottom:calc(max(18px, env(safe-area-inset-bottom)) + 5.2rem)';
    const down = (e) => { e.preventDefault(); if (racing()) { fire('keydown', ' '); hb.classList.add('on'); } };
    const up = (e) => { e.preventDefault(); fire('keyup', ' '); hb.classList.remove('on'); };
    hb.addEventListener('pointerdown', down);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => hb.addEventListener(n, up));
    const pb = document.createElement('button');
    pb.className = 'tb'; pb.textContent = 'II'; pb.setAttribute('aria-label', 'Pause');
    pb.style.cssText = 'top:max(12px,env(safe-area-inset-top));bottom:auto;left:50%;transform:translateX(-50%);width:3rem;height:3rem;font-size:1rem';
    pb.addEventListener('pointerdown', (e) => { e.preventDefault(); if (racing() && !MP.live()) fire('keydown', 'p'); });
    tc.append(hb, pb);
  }

  // ---- multiplayer ----
  const MP = window.MP = {};
  const panel = $('#panel');
  let peer = null, conns = [], hostConn = null, isHost = false, slot = 0, slots = [true, false, false, false];
  let track = 0, active = false, inMP = false, timer = 0, code = '', list = null, gen = 0, joinT = 0;
  // keep menu hotkeys (Enter, digits, M, arrows) from firing while typing in lobby
  panel.addEventListener('keydown', (e) => { if (inMP) e.stopPropagation(); });

  MP.live = () => active;
  const note = (t) => { const e = $('#mm'); if (e) e.textContent = t; };

  function teardown() {
    clearInterval(timer); clearTimeout(joinT); gen++; active = false; list = null;
    try { conns.forEach((c) => c.close()); } catch (e) {}
    try { if (hostConn) hostConn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conns = []; hostConn = null; peer = null;
  }

  MP.open = () => {
    teardown(); inMP = true;
    panel.innerHTML = `<h1>Play online</h1><p>Host a room and share the code, or join a friend's room. Up to 4 players, no AI.</p>
<button id="mh">Host a room</button>
<input id="mc" class="inp" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" aria-label="Room code">
<div class="row"><button id="mj">Join room</button><button class="ghost" id="mb">Back</button></div>
<p class="msg" id="mm" role="status"></p>`;
    $('#mh').onclick = hostRoom; $('#mj').onclick = join; $('#mb').onclick = MP.close;
    $('#mc').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#mh').focus();
  };
  MP.close = () => { teardown(); inMP = false; G.showMenu(); };

  function render(msg) {
    if (!inMP) return;
    const n = slots.filter(Boolean).length;
    const rows = slots.map((on, i) => on
      ? `<li><span style="color:${COL[i]}">● ${NAMES[i]}${i === 0 ? ' (host)' : ''}${i === slot ? ' (you)' : ''}</span><b>In</b></li>`
      : '<li><span>Waiting for player…</span></li>').join('');
    const tracks = isHost
      ? `<div class="tracks">${TRACKS.map((t, i) => `<button class="tk${i === track ? ' sel' : ''}" data-i="${i}" aria-pressed="${i === track}"><b>${t.name}</b><span>${t.tag}</span></button>`).join('')}</div>`
      : `<p>Track: <b>${TRACKS[track].name}</b></p>`;
    panel.innerHTML = `<h1>Room</h1><p>Share this code</p><div class="code" aria-label="Room code">${code}</div>
<ul class="plist">${rows}</ul>${tracks}
<div class="row">${isHost ? `<button id="ms"${n < 2 ? ' disabled' : ''}>Start race</button>` : ''}<button class="ghost" id="mp">Copy code</button><button class="ghost" id="ml">Leave</button></div>
<p class="msg" id="mm" role="status">${msg || (isHost ? (n < 2 ? 'Waiting for at least one friend.' : '') : 'Waiting for host to start.')}</p>`;
    if (isHost) {
      $('#ms').onclick = start;
      panel.querySelectorAll('.tk').forEach((b) => { b.onclick = () => { track = +b.dataset.i; lobby(); }; });
    }
    $('#mp').onclick = () => { try { navigator.clipboard.writeText(code); note('Code copied.'); } catch (e) { note('Copy failed. Code: ' + code); } };
    $('#ml').onclick = MP.close;
  }

  const lobby = () => { const m = { t: 'lobby', slots, track }; conns.forEach((c) => c.open && c.send(m)); render(); };

  async function hostRoom() {
    if (typeof Peer === 'undefined') return note('Online play needs internet.');
    teardown(); isHost = true; slot = 0; slots = [true, false, false, false]; track = G.trackIdx;
    code = Array.from({ length: 4 }, () => ABC[(Math.random() * ABC.length) | 0]).join('');
    const my = gen, p = await mkPeer(PFX + code);
    if (my !== gen) { p.destroy(); return; }
    peer = p;
    peer.on('open', () => { inMP = true; render(); });
    peer.on('error', (e) => { if (e.type === 'unavailable-id') hostRoom(); else note('Connection problem: ' + e.type); });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const s = [1, 2, 3].find((i) => !slots[i]);
        if (active || s === undefined) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
        slots[s] = true; conn.slot = s; conns.push(conn);
        conn.send({ t: 'hi', slot: s }); lobby();
      });
      conn.on('data', (d) => onData(d, conn));
      conn.on('close', () => drop(conn));
    });
  }

  async function join() {
    const v = ($('#mc').value || '').trim().toUpperCase();
    if (v.length !== 4) return note('Enter the 4-character code.');
    if (typeof Peer === 'undefined') return note('Online play needs internet.');
    teardown(); isHost = false; code = v; note('Connecting…');
    const my = gen, p = await mkPeer();
    if (my !== gen) { p.destroy(); return; }
    peer = p;
    let opened = false;
    joinT = setTimeout(() => note(opened
      ? 'Room found but no direct link. Ask host to keep the room screen open. Your network may block direct play.'
      : 'Cannot reach the matchmaking server (PeerJS). Check internet, or try another network or VPN.'), 12000);
    peer.on('error', (e) => note(e.type === 'peer-unavailable' ? 'Room not found.' : 'Connection problem: ' + e.type));
    peer.on('open', () => {
      hostConn = peer.connect(PFX + code, { reliable: true });
      opened = true;
      hostConn.on('open', () => { clearTimeout(joinT); note('Connected.'); });
      hostConn.on('data', (d) => onData(d, hostConn));
      hostConn.on('close', () => {
        const was = active; teardown();
        if (was) G.toast('Host left'); else { MP.open(); note('Host closed the room.'); }
      });
    });
  }

  function drop(conn) {
    conns = conns.filter((c) => c !== conn);
    if (conn.slot == null) return;
    slots[conn.slot] = false;
    if (active && list) {
      const i = list.findIndex((c) => c.slot === conn.slot);
      if (i >= 0) list.splice(i, 1);
      G.toast('Player left');
    } else lobby();
  }

  function onData(d, from) {
    if (d.t === 's') {
      const c = list && list.find((x) => x.remote && x.slot === d.s);
      if (c) c.tgt = Object.assign(d, { rt: performance.now() });
      if (isHost) conns.forEach((o) => o !== from && o.open && o.send(d));
    } else if (d.t === 'hi') { slot = d.slot; }
    else if (d.t === 'lobby') { slots = d.slots; track = d.track; inMP = true; render(); }
    else if (d.t === 'start') begin(d);
    else if (d.t === 'full') { teardown(); MP.open(); note('Room full or race already started.'); }
  }

  function start() {
    if (slots.filter(Boolean).length < 2) return;
    const m = { t: 'start', track, slots };
    conns.forEach((c) => c.send(m)); begin(m);
  }

  function begin(m) {
    track = m.track; slots = m.slots; inMP = false;
    G.selectTrack(track); G.newRace();
    const old = G.cars, me = G.player;
    const F = ['x', 'y', 'a', 'idx', 'P', 'dist'];
    const tpl = old.map((c) => { const o = {}; F.forEach((k) => o[k] = c[k]); return o; });
    const put = (c, t, col) => { Object.assign(c, t, { px: t.x, py: t.y, color: col }); };
    const ai = old.filter((c) => c !== me);
    put(me, tpl[slot], COL[slot]);
    list = [me];
    for (let s = 0; s < 4; s++) if (slots[s] && s !== slot) {
      const c = ai.pop();
      put(c, tpl[s], COL[s]);
      c.remote = true; c.slot = s; c.tgt = null; c.baseSkill = c.skill = 1;
      list.push(c);
    }
    G.cars = list; active = true;
    clearInterval(timer); timer = setInterval(tick, 50);
  }

  function tick() {
    if (G.cars !== list) { teardown(); return; } // new solo race started: stop syncing
    const p = G.player;
    const m = { t: 's', s: slot, x: p.x, y: p.y, a: p.a, vx: p.vx, vy: p.vy, st: p.steer, b: p.boosting, d: p.drifting, br: p.braking, sl: p.slip };
    if (isHost) conns.forEach((c) => c.open && c.send(m));
    else if (hostConn && hostConn.open) hostConn.send(m);
  }

  // called from index.html update loop instead of stepCar for remote cars
  MP.remote = (c, h) => {
    const g = c.tgt; if (!g) return;
    const age = Math.min(0.2, (performance.now() - g.rt) / 1000), k = Math.min(1, 14 * h);
    c.px = c.x; c.py = c.y;
    c.x += (g.x + g.vx * age - c.x) * k; c.y += (g.y + g.vy * age - c.y) * k;
    c.a += angDiff(g.a, c.a) * k;
    c.vx = g.vx; c.vy = g.vy; c.steer = g.st; c.boosting = g.b; c.drifting = g.d; c.braking = g.br; c.slip = g.sl;
    nearest(c);
  };
})();
