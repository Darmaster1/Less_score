import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import { customAlphabet } from "nanoid";

import { createGame, applyAction, randomValidAuto } from "./game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

const newCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

/** rooms: code -> { code, hostId, players: [{id, socketId, name, connected}], game, settings, mode, started, chat:[] } */
const rooms = new Map();

function publicRoomState(room, forSocketId) {
  const player = room.players.find((p) => p.socketId === forSocketId);
  return {
    code: room.code,
    hostId: room.hostId,
    youId: player ? player.id : null,
    started: room.started,
    settings: room.settings,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === room.hostId,
    })),
    game: room.game ? sanitizeGameForPlayer(room.game, player ? player.id : null) : null,
    chat: room.chat.slice(-50),
  };
}

function sanitizeGameForPlayer(game, playerId) {
  return {
    phase: game.phase, // 'playing' | 'roundEnd' | 'gameEnd'
    mode: game.mode,
    pointLimit: game.pointLimit,
    turnTimer: game.turnTimer,
    turnEndsAt: game.turnEndsAt,
    currentTurnPlayerId: game.currentTurnPlayerId,
    drawPileCount: game.drawPile.length,
    discardPile: game.discardPile, // visible cards
    lastDiscardWasSequence: game.lastDiscardWasSequence,
    lastDiscardSize: game.lastDiscardSize,
    eliminated: game.eliminated,
    cumulativeScores: game.cumulativeScores,
    lastRoundScores: game.lastRoundScores,
    log: game.log.slice(-30),
    winnerId: game.winnerId,
    yourHand: game.hands[playerId] || [],
    handCounts: Object.fromEntries(
      Object.entries(game.hands).map(([pid, h]) => [pid, h.length]),
    ),
    declarerId: game.declarerId,
    roundEndDetail: game.roundEndDetail,
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit("room:state", publicRoomState(room, p.socketId));
  }
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  const game = room.game;
  if (!game || game.phase !== "playing") return;
  if (!game.turnTimer || game.turnTimer === 0) {
    game.turnEndsAt = null;
    return;
  }
  game.turnEndsAt = Date.now() + game.turnTimer * 1000;
  room._timer = setTimeout(() => {
    // auto-play
    const pid = game.currentTurnPlayerId;
    if (!pid) return;
    const auto = randomValidAuto(game, pid);
    applyAction(game, pid, auto);
    game.log.push({ t: Date.now(), msg: `${nameOf(room, pid)} ran out of time — auto-played.` });
    if (game.phase === "playing") startTurnTimer(room);
    broadcastRoom(room);
  }, game.turnTimer * 1000 + 50);
}

function clearTurnTimer(room) {
  if (room._timer) {
    clearTimeout(room._timer);
    room._timer = null;
  }
}

function nameOf(room, pid) {
  const p = room.players.find((x) => x.id === pid);
  return p ? p.name : "?";
}

io.on("connection", (socket) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  socket.on("room:create", ({ name }, cb) => {
    const code = newCode();
    const playerId = customAlphabet("0123456789abcdef", 8)();
    const room = {
      code,
      hostId: playerId,
      players: [{ id: playerId, socketId: socket.id, name: name || "Host", connected: true }],
      game: null,
      settings: { mode: "setpoints", pointLimit: 100, turnTimer: 0 },
      started: false,
      chat: [],
      _timer: null,
    };
    rooms.set(code, room);
    currentRoomCode = code;
    currentPlayerId = playerId;
    socket.join(code);
    cb && cb({ ok: true, code, playerId });
    broadcastRoom(room);
  });

  socket.on("room:join", ({ code, name, rejoinPlayerId }, cb) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: "Room not found" });

    // Rejoin existing
    if (rejoinPlayerId) {
      const existing = room.players.find((p) => p.id === rejoinPlayerId);
      if (existing) {
        existing.socketId = socket.id;
        existing.connected = true;
        currentRoomCode = code;
        currentPlayerId = existing.id;
        socket.join(code);
        cb && cb({ ok: true, code, playerId: existing.id });
        broadcastRoom(room);
        return;
      }
    }

    if (room.started) {
      return cb && cb({ ok: false, error: "Game already started" });
    }
    const playerId = customAlphabet("0123456789abcdef", 8)();
    room.players.push({ id: playerId, socketId: socket.id, name: name || "Player", connected: true });
    currentRoomCode = code;
    currentPlayerId = playerId;
    socket.join(code);
    cb && cb({ ok: true, code, playerId });
    broadcastRoom(room);
  });

  socket.on("room:settings", ({ mode, pointLimit, turnTimer }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId || room.started) return;
    if (mode === "setpoints" || mode === "elimination") room.settings.mode = mode;
    if (Number.isFinite(pointLimit) && pointLimit > 0) room.settings.pointLimit = Math.floor(pointLimit);
    if ([0, 30, 60].includes(turnTimer)) room.settings.turnTimer = turnTimer;
    broadcastRoom(room);
  });

  socket.on("room:start", () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId || room.started) return;
    if (room.players.length < 2) return;
    room.started = true;
    room.game = createGame(
      room.players.map((p) => p.id),
      room.settings,
    );
    room.game.log.push({ t: Date.now(), msg: `Game started — ${room.settings.mode} mode.` });
    startTurnTimer(room);
    broadcastRoom(room);
  });

  socket.on("game:action", (action, cb) => {
    const room = rooms.get(currentRoomCode);
    if (!room || !room.game) return cb && cb({ ok: false, error: "no game" });
    const game = room.game;
    if (game.phase !== "playing") return cb && cb({ ok: false, error: "not in play" });
    if (game.currentTurnPlayerId !== currentPlayerId) return cb && cb({ ok: false, error: "not your turn" });

    const result = applyAction(game, currentPlayerId, action);
    if (!result.ok) return cb && cb({ ok: false, error: result.error });

    // Log message
    game.log.push({ t: Date.now(), msg: result.message.replace("{you}", nameOf(room, currentPlayerId)) });

    if (game.phase === "playing") startTurnTimer(room);
    else clearTurnTimer(room);

    broadcastRoom(room);
    cb && cb({ ok: true });
  });

  socket.on("game:nextRound", () => {
    const room = rooms.get(currentRoomCode);
    if (!room || !room.game) return;
    if (room.hostId !== currentPlayerId) return;
    if (room.game.phase !== "roundEnd") return;
    const activeIds = room.players.map((p) => p.id).filter((id) => !room.game.eliminated.includes(id));
    if (activeIds.length <= 1) return;
    const prev = room.game;
    const newGame = createGame(activeIds, room.settings, {
      cumulativeScores: prev.cumulativeScores,
      eliminated: prev.eliminated,
    });
    newGame.log = prev.log.slice(-30);
    newGame.log.push({ t: Date.now(), msg: "New round begins." });
    room.game = newGame;
    startTurnTimer(room);
    broadcastRoom(room);
  });

  socket.on("game:resetLobby", () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId) return;
    clearTurnTimer(room);
    room.started = false;
    room.game = null;
    broadcastRoom(room);
  });

  socket.on("chat:send", ({ text }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const p = room.players.find((x) => x.id === currentPlayerId);
    if (!p) return;
    text = String(text || "").slice(0, 200);
    if (!text.trim()) return;
    room.chat.push({ from: p.name, text, t: Date.now() });
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const p = room.players.find((x) => x.id === currentPlayerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;

    // host transfer
    if (room.hostId === currentPlayerId) {
      const next = room.players.find((x) => x.connected);
      if (next) {
        room.hostId = next.id;
        if (room.game) room.game.log.push({ t: Date.now(), msg: `${next.name} is the new host.` });
      }
    }

    // If everyone disconnected for a while, clean up
    const anyConnected = room.players.some((x) => x.connected);
    if (!anyConnected) {
      setTimeout(() => {
        const r = rooms.get(currentRoomCode);
        if (r && !r.players.some((x) => x.connected)) {
          clearTurnTimer(r);
          rooms.delete(currentRoomCode);
        }
      }, 5 * 60 * 1000);
    }

    broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Least Score server listening on :${PORT}`);
});
