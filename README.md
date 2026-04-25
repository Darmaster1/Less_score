# Less Score — Online Multiplayer Card Game

https://less-score.onrender.com/

A real-time multiplayer "Less Score" card game. Built with **Node.js + Express + Socket.IO** and a vanilla HTML/CSS/JS frontend. Works on phones and laptops with a fully responsive UI.

Features: ready system, customizable rules (hand size, penalty, triplets, 4/6+ sequences, wrap-around), card back themes, spectator mode, in-game rules reference, and end-of-game match statistics.

## Quick start (local)

```bash
cd artifacts/api-server
npm install
PORT=8080 node server.js
```

Open http://localhost:8080 — create a room, share the code, and play.

## Project layout

```
Less-Score
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
