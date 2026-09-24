# ZINKK2

A multiplayer tank battle game: a staging lobby with two sectors (max 4
players each), twin-joystick controls, and real-time combat. This
version runs on its own small Node server instead of depending on
Claude — it works anywhere that can run a persistent Node process.

Everything lives flat, right next to each other:

- `server.js` -- Express serves `index.html`, and a WebSocket endpoint
  at `/ws` relays player state (position, aim, health, score) and
  events (shots, kills) between everyone connected.
- `index.html` -- the entire game client: UI, canvas rendering, game
  logic, and a small WebSocket client that talks to `server.js`.

## Run it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two or more browser tabs/devices
on the same network to test with multiple players.

## Deploy to Render

1. Create a **new GitHub repository** and upload ALL of these files
   at once (select every file in this folder and drag them all into
   GitHub's "Add file → Upload files" page together, or push via git).
   You should end up with `index.html`, `server.js`, `package.json`,
   `.gitignore`, and `README.md` all sitting at the top level of the
   repo — no subfolders.
2. On [render.com](https://render.com), create a **new Web Service**
   (not a Static Site — this needs a running server) and point it at
   the repo.
3. Build command: `npm install`
   Start command: `npm start`
4. Deploy. Render assigns a `https://your-app.onrender.com` URL —
   share that link with friends to play together.
5. Check the deploy logs for `Tank Arena server listening on port ...`
   to confirm it started cleanly.

**Note:** static-only hosts like GitHub Pages or Netlify's free tier
can serve `index.html` but can't run `server.js`, so multiplayer won't
work there — you need something that keeps a Node process running.

## Hosting your own room

Hit **+ HOST** in the lobby to open a room of your own: give it a name,
pick a map (Crossfire Ruins, Open Flats, Fortress, Switchback, Pillar
Grid, The Cross) and a player cap (2-10), then **CREATE & DEPLOY**. The
room shows up under **Hosted rooms** for everyone in the lobby, and
disappears once its last player leaves. Hosted rooms are untimed. Maps
live in the `MAPS` table near the top of `index.html`; add an entry
there (and its id to `MAP_ORDER` and `KNOWN_MAPS` in `server.js`) to
add a new one. Keep the 8 `SPAWNS` points clear of obstacles.

## /admin tank picker

In a game, press `/` or Enter (or tap the `/` button in the top bar),
type `/admin` and press Enter. You'll be asked for the admin password;
tick **Remember me** to stay unlocked on that device (only a token is
saved in the browser, never the password). Then pick any tank (single,
twin, triple, diagonal, omni, triplet, quad, necromancer, octo) or
AUTO, where the tank follows your kill count. Other players see your
tank. The override resets when you leave the room. `/logout` locks admin
again and forgets the saved login.

Once unlocked, `/kill @playername` destroys that player's tank (they
respawn after 2 seconds; nobody is credited with the kill). It works on
players in your current room, matches names case-insensitively, and
accepts a unique prefix. If two players share a name, use the suffix
shown in the score strip, e.g. `/kill @ROOK #2`. Without a login it
just opens the login prompt.

The password is checked on the server, which also ignores tank overrides
from anyone who hasn't unlocked. It is read from the `ADMIN_PASSWORD`
environment variable and defaults to `12345`, so **set your own on
Render** (Environment tab) before sharing the link. Changing it signs out
every remembered device.

## Room 1 match timer

Room 1 runs on a server-side 10 minute timer. It starts the moment two
players are in the room. When it hits zero, everyone in Room 1 is sent
back to the lobby and a results panel announces the player with the most
kills (equal top scores are reported as a draw). If Room 1 empties out
before time is up, the timer is cancelled and the next pair of players
gets a fresh 10 minutes. Room 2 is untimed. To change the length, edit
`MATCH_MS` in `server.js`.

## Notes on the multiplayer model

There's no server-side game simulation: each client simulates its own
tank and bullets, is authoritative over its own health (only you can
damage yourself out), and broadcasts state ~20x/second. This keeps
things simple and low-latency for a casual game, but it isn't
cheat-proof -- a modified client could report false damage or
position. Good enough for playing with friends; not meant for a
public, competitive deployment.
