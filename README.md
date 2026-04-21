# Least Score — Multiplayer Card Game

A real-time multiplayer "Least Score" card game. Built with **Node.js + Express + Socket.IO** and a vanilla HTML/CSS/JS frontend. Works on phones and laptops with a fully responsive UI.

## Quick start (local)

```bash
cd artifacts/api-server
npm install
PORT=8080 node server.js
```

Open http://localhost:8080 — create a room, share the code, and play.

---

## Deploying to Render (Node.js, no Firebase)

This app deploys as a single Node.js Web Service on Render. Socket.IO works out of the box because Render supports WebSockets on Web Services.

### Step 1 — Make a standalone repo

The simplest path is to push only this folder (`artifacts/api-server`) to a new GitHub repo. From the project root:

```bash
mkdir /tmp/least-score && cp -r artifacts/api-server/* artifacts/api-server/.gitignore /tmp/least-score/ 2>/dev/null
cd /tmp/least-score
git init && git add . && git commit -m "Initial commit"
# Create a GitHub repo (e.g. via gh CLI) then:
git remote add origin https://github.com/<your-username>/least-score.git
git branch -M main && git push -u origin main
```

> Don't include `node_modules` or `dist` — Render will install dependencies for you.

### Step 2 — Create the Render service

1. Go to **https://dashboard.render.com** and click **New → Web Service**.
2. Connect your GitHub account and select the `least-score` repo.
3. Fill in:
   - **Name:** `least-score`
   - **Region:** any close to your players
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Instance type:** Free is fine for a few players
4. Under **Advanced → Environment Variables**, leave blank — Render injects `PORT` automatically.
5. Click **Create Web Service**.

Render will build and deploy in ~1–2 minutes. You'll get a URL like `https://least-score.onrender.com`. Open it on your laptop, share the link with family, and play in real time.

### Step 3 — Health check (optional)

In Render's settings, set **Health Check Path** to `/healthz`.

### Notes

- Free Render web services sleep after 15 min of inactivity. The first request after sleep takes ~30 s to wake up. Upgrading to a paid instance keeps it warm.
- WebSockets require a standard Render **Web Service** (not Static Site). This is what we set above.
- Game state lives in memory. If Render restarts the service, in-progress rooms are lost. For a persistent setup, swap the in-memory `Map` in `server.js` with Redis (Render has managed Redis).

---

## Project layout

```
artifacts/api-server/
├── server.js          Express + Socket.IO server, room & lobby management
├── game.js            Pure game logic — deck, validation, scoring
├── public/
│   ├── index.html     Single-page client
│   ├── style.css      Mobile-first responsive styling
│   └── app.js         Vanilla JS UI + Socket.IO client
├── package.json
└── README.md
```

## Game rules implemented

- 5-card hand, standard 52-card deck (Ace = 1, JQK = 10).
- Discard sets: single, pair, four-of-a-kind, 3-card sequence, 5-card sequence (no triplets, no 4-card sequences, no wrap-around).
- Draw from deck OR top of discard pile. If last discard was a sequence, you may pick **any** card from it.
- Declare scoring (3 cases): strictly lowest → 0 / tie → declarer 0 keeps others' scores / someone lower → declarer +50, lowest → 0.
- Two modes: **Set Points** (last to reach limit wins) and **Elimination** (highest each round is out).
- Turn timer: none / 30s / 60s with auto-play on expiry.
- Lobby with shareable code + invite link, host controls, chat, host transfer on disconnect, rejoin via session.

Happy gaming.
