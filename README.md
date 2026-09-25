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
Grid, The Cross), a **game mode**, and a player cap (2-10), then
**CREATE & DEPLOY**. The room shows up under **Hosted rooms** for
everyone in the lobby, and disappears once its last player leaves.
Hosted rooms are untimed. Maps live in the `MAPS` table near the top of
`index.html`; add an entry there (and its id to `MAP_ORDER` and
`KNOWN_MAPS` in `server.js`) to add a new one. Keep the 8 `SPAWNS`
points clear of obstacles.

### Waiting for players

Joining a hosted room doesn't drop you straight into combat. You land
in a waiting lobby that lists everyone who's joined so far; whoever
joined first is the **host** (tagged in the list) and gets a
**START MATCH** button once at least 2 players are in. Nobody can move
or shoot until the host presses it, at which point everyone currently
in the room enters together. Anyone can leave the waiting lobby with
the &times; button. Joining a room that's already started (a late
join) skips the wait and drops you straight in, same as before. Room 1
and Room 2 have no host or waiting step -- they play exactly as they
always have.

### Game modes

- **FFA** — every tank for itself. Identical to Room 1 / Room 2, just
  on your chosen map and cap.
- **2 Teams** — the lobby is auto-balanced onto Red vs Blue as people
  join (whichever side is smaller gets the next joiner). Hull color
  becomes the team color, and there's no friendly fire — teammates'
  bullets pass straight through each other. The score strip groups by
  team and shows a combined team score (sum of each member's kills).
- **Capture the Flag** — Teams, plus each side has a flag sitting at a
  fixed base on opposite ends of the map. Walk into the enemy flag
  while it's still at its base to pick it up (only one enemy flag can
  be carried at a time), then get it back to your own base to score a
  capture. Dying while carrying a flag sends it straight back home. The
  score strip shows each team's capture count, and the room announces a
  winner at 3 captures — play just keeps going after that, since hosted
  rooms don't force a reset.

Team modes have the same trust model as the rest of the game (see
"Notes on the multiplayer model" below): pickups, captures, and team
assignment are all decided client-side, so they're fine for casual play
with friends but not cheat-proof.

## /admin tank picker

In a game, press `/` or Enter (or tap the `/` button in the top bar),
type `/admin` and press Enter. You'll be asked for the admin password;
tick **Remember me** to stay unlocked on that device (only a token is
saved in the browser, never the password). Pick a tank (single, twin,
triple, diagonal, omni, triplet, quad, necromancer, octo) or AUTO,
where the tank follows kill count, then pick who it applies to from the
list of everyone currently in your room -- yourself included. The
switch happens immediately for that player (their own screen updates
too, with a toast letting them know an admin changed their tank), and
resets back to AUTO when they leave the room. `/logout` locks admin
again and forgets the saved login.

Once unlocked, `/kill @playername` destroys that player's tank (they
respawn after 2 seconds; nobody is credited with the kill), and
`/ban @playername` disconnects them and blocks their IP from
reconnecting to any room on this server (an in-memory list -- it resets
if the server restarts). Both work on players in your current room,
match names case-insensitively, and accept a unique prefix. If two
players share a name, use the suffix shown in the score strip, e.g.
`/kill @ROOK #2`. Without a login these just open the login prompt.

`/banned` opens a list of everyone currently banned (name + how long
ago) with an **UNBAN** button on each row. Unbanning always asks for
the admin password again, typed fresh -- even on a device that's
already unlocked via a remembered login -- since undoing a ban is
sensitive enough to want a real confirmation, not just a click. Five
wrong attempts locks it out for 30 seconds, same as the main login.

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
damage yourself out), and broadcasts state ~20x/second. Team modes
follow the same pattern -- team assignment, flag pickups/captures, and
friendly-fire immunity are all decided by the player's own client and
published as presence, not verified by the server. A hosted room's
host status and started/not-started flag work the same way (whoever
joined first owns that room's live `roomMeta`). This keeps things
simple and low-latency for a casual game, but it isn't cheat-proof -- a
modified client could report false damage, position, captures, or
claim to be the host. Good enough for playing with friends; not meant
for a public, competitive deployment.
