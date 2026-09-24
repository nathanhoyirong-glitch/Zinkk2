// Tank Arena -- standalone multiplayer server
//
// Serves the game (public/index.html) as static files and runs a
// WebSocket endpoint at /ws that mirrors the small "room" protocol the
// client expects: each connection gets a peer id, can push presence
// updates (merged server-side and rebroadcast to everyone), and can
// emit one-off events (shoot / kill) that get relayed to other peers.
//
// Run locally:   npm install && npm start
// Deploy (Render, Railway, Fly, a VPS, etc.): any host that runs a
// long-lived Node process and exposes the PORT env var works. Static
// hosts like GitHub Pages / Netlify will NOT work for this file --
// they can't run server.js, only serve the client.

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const fs = require('fs');
const app = express();

const publicDir = path.join(__dirname, 'public');
const servingDir = fs.existsSync(path.join(publicDir, 'index.html')) ? publicDir : __dirname;
console.log('Serving static files from: ' + servingDir);
app.use(express.static(servingDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.get('/', (req, res, next) => {
  const indexPath = path.join(servingDir, 'index.html');
  if (fs.existsSync(indexPath)) return next();
  res.status(500).send(
    'index.html was not found next to server.js (checked ./public and ./).\n' +
    'Make sure your GitHub repo actually contains index.html -- ' +
    'check the repo file list on github.com.'
  );
});

// peerId -> { ws, presence: {} }
const peers = new Map();

// Hosted rooms live entirely in player presence (roomId 'H-XXXXX' plus a
// roomMeta {name,map,cap}). Clamp whatever clients send so a bad client
// can't push odd room ids or oversized values to everyone else.
const ROOM_ID_RE = /^(A|B|H-[A-Z0-9]{5})$/;
const KNOWN_MAPS = new Set(['crossfire', 'flats', 'fortress', 'switchback', 'grid', 'cross']);
function sanitizePresence(d) {
  if ('roomId' in d && d.roomId !== null && !(typeof d.roomId === 'string' && ROOM_ID_RE.test(d.roomId))) delete d.roomId;
  if ('roomMeta' in d && d.roomMeta !== null) {
    const m = d.roomMeta;
    if (!m || typeof m !== 'object') delete d.roomMeta;
    else d.roomMeta = {
      name: String(m.name || 'CUSTOM ROOM').slice(0, 20),
      map: KNOWN_MAPS.has(m.map) ? m.map : 'crossfire',
      cap: Math.max(2, Math.min(10, parseInt(m.cap, 10) || 4))
    };
  }
  return d;
}

function deepMerge(target, patch) {
  for (const key of Object.keys(patch || {})) {
    const val = patch[key];
    if (val && typeof val === 'object' && !Array.isArray(val) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], val);
    } else {
      target[key] = val;
    }
  }
  return target;
}

// How often presence changes go out to everyone, in Hz. Lower = less CPU/
// bandwidth per tick (kinder to constrained free-tier hosts), at the cost
// of remote players looking slightly less frequently-updated -- the client
// smooths between updates (see the interpolation code in index.html) so
// this can go fairly low without looking choppy.
const TICK_HZ = 25;
const TICK_MS = Math.round(1000 / TICK_HZ);

let peersDirty = false;
function markPeersDirty() { peersDirty = true; }
function broadcastPeersNow() {
  const list = Array.from(peers.entries()).map(([id, p]) => ({ peer: id, presence: p.presence }));
  const msg = JSON.stringify({ type: 'peers', list });
  for (const [, p] of peers) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
  }
}
setInterval(() => {
  if (!peersDirty) return;
  peersDirty = false;
  broadcastPeersNow();
}, TICK_MS);
function broadcastPeers() { markPeersDirty(); }

// ---------------------------------------------------------------
// Room 1 match timer (server-authoritative)
//
// Room 1 is sector 'A'. The moment it holds 2+ players a 10 minute
// countdown starts. When it hits zero everyone in the room is removed
// from it, and whoever has the highest kill score is announced the
// winner (ties are reported as a draw). If the room empties out
// before time is up, the match is cancelled and the next pair of
// players gets a fresh 10 minutes.
// ---------------------------------------------------------------
const TIMED_SECTOR = 'A';
const MATCH_MS = 10 * 60 * 1000;
const MIN_PLAYERS_TO_START = 2;
let match = null; // { endsAt: epoch ms } while a match is running

function playersIn(sector) {
  return Array.from(peers.entries()).filter(([, p]) => p.presence && p.presence.roomId === sector);
}
function sendAll(obj) {
  const msg = JSON.stringify(obj);
  for (const [, p] of peers) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
  }
}
function matchMessage() {
  return { type: 'match', sector: TIMED_SECTOR, endsAt: match ? match.endsAt : null, now: Date.now() };
}
function evaluateMatch() {
  const n = playersIn(TIMED_SECTOR).length;
  if (!match && n >= MIN_PLAYERS_TO_START) {
    match = { endsAt: Date.now() + MATCH_MS };
    console.log('Room 1 match started');
    sendAll(matchMessage());
  } else if (match && n === 0) {
    match = null;
    console.log('Room 1 emptied, match cancelled');
    sendAll(matchMessage());
  }
}
function endMatch() {
  const players = playersIn(TIMED_SECTOR);
  const results = players.map(([id, p]) => ({
    peer: id,
    name: p.presence.name || 'OPERATOR',
    color: p.presence.color,
    score: p.presence.score || 0
  })).sort((a, b) => b.score - a.score);
  const top = results.length ? results[0].score : 0;
  const winners = results.filter(r => r.score === top).map(r => r.peer);

  match = null;
  console.log('Room 1 match ended', JSON.stringify(results));
  sendAll({ type: 'matchEnd', sector: TIMED_SECTOR, results, winners });

  // kick everyone out of the room
  for (const [, p] of players) {
    p.presence.roomId = null;
    p.presence.alive = false;
    p.presence.hp = 0;
    p.presence.score = 0;
  }
  markPeersDirty();
  sendAll(matchMessage());
}
setInterval(() => {
  if (match && Date.now() >= match.endsAt) endMatch();
}, 500);

wss.on('connection', (ws) => {
  const id = crypto.randomUUID();
  peers.set(id, { ws, presence: {} });
  ws.send(JSON.stringify({ type: 'welcome', peer: id }));
  ws.send(JSON.stringify(matchMessage()));
  broadcastPeers();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const p = peers.get(id);
    if (!p) return;

    if (msg.type === 'ping') {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
    } else if (msg.type === 'presence' && msg.data && typeof msg.data === 'object') {
      deepMerge(p.presence, sanitizePresence(msg.data));
      broadcastPeers();
      evaluateMatch();
    } else if (msg.type === 'emit' && typeof msg.topic === 'string') {
      const out = JSON.stringify({ type: 'event', topic: msg.topic, data: msg.data, from: id });
      for (const [pid, pp] of peers) {
        if (pid === id) continue; // sender already renders its own action locally
        if (pp.ws.readyState === WebSocket.OPEN) pp.ws.send(out);
      }
    }
  });

  ws.on('close', () => {
    peers.delete(id);
    broadcastPeers();
    evaluateMatch();
  });

  ws.on('error', () => {
    peers.delete(id);
    broadcastPeers();
    evaluateMatch();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Tank Arena server listening on port ' + PORT);
});
