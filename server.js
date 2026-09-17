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

let broadcastQueued = false;
function broadcastPeers() {
  // coalesce bursts of presence updates into one broadcast per tick
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    const list = Array.from(peers.entries()).map(([id, p]) => ({ peer: id, presence: p.presence }));
    const msg = JSON.stringify({ type: 'peers', list });
    for (const [, p] of peers) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  const id = crypto.randomUUID();
  peers.set(id, { ws, presence: {} });
  ws.send(JSON.stringify({ type: 'welcome', peer: id }));
  broadcastPeers();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const p = peers.get(id);
    if (!p) return;

    if (msg.type === 'presence' && msg.data && typeof msg.data === 'object') {
      deepMerge(p.presence, msg.data);
      broadcastPeers();
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
  });

  ws.on('error', () => {
    peers.delete(id);
    broadcastPeers();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Tank Arena server listening on port ' + PORT);
});
