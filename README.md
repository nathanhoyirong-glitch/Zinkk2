# Tank Arena (standalone)

A multiplayer tank battle game: a staging lobby with two sectors (max 4
players each), twin-joystick controls, and real-time combat. This
version runs on its own small Node server instead of depending on
Claude — it works anywhere that can run a persistent Node process.

- `server.js` -- Express serves the client, and a WebSocket endpoint
  at `/ws` relays player state (position, aim, health, score) and
  events (shots, kills) between everyone connected.
- `public/index.html` -- the entire game client: UI, canvas rendering,
  game logic, and a small WebSocket client that talks to `server.js`.

## Run it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two or more browser tabs/devices
on the same network to test with multiple players.

## Deploy to Render

1. Push this repo to GitHub.
2. On [render.com](https://render.com), create a **new Web Service**
   (not a Static Site — this needs a running server) and point it at
   the repo.
3. Build command: `npm install`
   Start command: `npm start`
4. Deploy. Render assigns a `https://your-app.onrender.com` URL —
   share that link with friends to play together.

The same steps work on Railway, Fly.io, a plain VPS, or anywhere else
that runs a long-lived Node process and exposes the `PORT` it's given
(the server already reads `process.env.PORT`).

**Note:** static-only hosts like GitHub Pages or Netlify's free tier
can serve `public/index.html` but can't run `server.js`, so
multiplayer won't work there — you need something that keeps a Node
process running.

## Notes on the multiplayer model

There's no server-side game simulation: each client simulates its own
tank and bullets, is authoritative over its own health (only you can
damage yourself out), and broadcasts state ~20x/second. This keeps
things simple and low-latency for a casual game, but it isn't
cheat-proof -- a modified client could report false damage or
position. Good enough for playing with friends; not meant for a
public, competitive deployment.
