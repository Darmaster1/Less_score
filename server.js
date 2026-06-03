import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import { customAlphabet } from "nanoid";
import { createGame, applyAction, randomValidAuto, DEFAULT_RULES } from "./game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 8080;

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
  pingInterval: 20000,   // ping client every 20s
  pingTimeout: 15000,    // disconnect if no pong within 15s
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

const newCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const newPlayerId = customAlphabet("0123456789abcdef", 8);
const rooms = new Map();

const DEFAULT_SETTINGS = () => ({
  mode: "setpoints",
  pointLimit: 100,
  turnTimer: 0,
  showHandsToSpectators: false,
  rules: { ...DEFAULT_RULES },
});

function sanitizeGame(game, room, playerId) {
  const inGame = playerId && game.playerIds.includes(playerId);
  const isEliminated = playerId && game.eliminated.includes(playerId);
  const isSpectator = !inGame || isEliminated;
  const yourHand = inGame && !isEliminated ? game.hands[playerId] || [] : [];

  let allHands = null;
  if (game.phase === "roundEnd" || game.phase === "gameEnd") {
    allHands = game.hands;
  } else if (isSpectator && game.showHandsToSpectators) {
    allHands = game.hands;
  }

  return {
    phase: game.phase,
    mode: game.mode,
    pointLimit: game.pointLimit,
    turnTimer: game.turnTimer,
    turnEndsAt: game.turnEndsAt,
    rules: game.rules,
    roundNumber: game.roundNumber,
    currentTurnPlayerId: game.currentTurnPlayerId,
    drawPileCount: game.drawPile.length,
    visibleDiscard: game.discardPile.slice(-game.lastDiscardSize),
    lastDiscardSize: game.lastDiscardSize,
    lastDiscardBy: game.lastDiscardBy,
    lastPlayedThisRound: game.lastPlayedThisRound,
    eliminated: game.eliminated,
    cumulativeScores: game.cumulativeScores,
    lastRoundScores: game.lastRoundScores,
    log: game.log.slice(-30),
    winnerId: game.winnerId,
    yourHand,
    allHands,
    isSpectator,
    showHandsToSpectators: game.showHandsToSpectators,
    handCounts: Object.fromEntries(Object.entries(game.hands).map(([pid, h]) => [pid, h.length])),
    declarerId: game.declarerId,
    roundEndDetail: game.roundEndDetail,
    stats: game.stats,
  };
}

function publicRoom(room, socketId) {
  const player = room.players.find((p) => p.socketId === socketId);
  return {
    code: room.code,
    hostId: room.hostId,
    youId: player ? player.id : null,
    started: room.started,
    settings: room.settings,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, connected: p.connected,
      isHost: p.id === room.hostId, ready: !!p.ready, cardBack: p.cardBack || "classic-blue",
    })),
    game: room.game ? sanitizeGame(room.game, room, player ? player.id : null) : null,
    chat: room.chat.slice(-80),
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit("room:state", publicRoom(room, p.socketId));
  }
}

function nameOf(room, pid) {
  const p = room.players.find((x) => x.id === pid);
  return p ? p.name : "?";
}

function startTimer(room) {
  clearTimer(room);
  const game = room.game;
  if (!game || game.phase !== "playing" || !game.turnTimer) {
    if (game) game.turnEndsAt = null;
    return;
  }
  game.turnEndsAt = Date.now() + game.turnTimer * 1000;
  room._timer = setTimeout(() => {
    const pid = game.currentTurnPlayerId;
    if (!pid) return;
    applyAction(game, pid, randomValidAuto(game, pid));
    game.log.push({ t: Date.now(), msg: `${nameOf(room, pid)} ran out of time — auto-played.` });
    if (game.phase === "playing") startTimer(room);
    broadcast(room);
  }, game.turnTimer * 1000 + 100);
}

function clearTimer(room) {
  if (room._timer) { clearTimeout(room._timer); room._timer = null; }
}

io.on("connection", (socket) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  socket.on("room:create", ({ name, cardBack }, cb) => {
    const code = newCode();
    const playerId = newPlayerId();
    const room = {
      code, hostId: playerId,
      players: [{ id: playerId, socketId: socket.id, name: (name || "Host").slice(0, 24),
        connected: true, ready: false, cardBack: cardBack || "classic-blue", lastSeen: Date.now() }],
      game: null, settings: DEFAULT_SETTINGS(), started: false, chat: [], _timer: null,
    };
    rooms.set(code, room);
    currentRoomCode = code;
    currentPlayerId = playerId;
    socket.join(code);
    cb && cb({ ok: true, code, playerId });
    broadcast(room);
  });

  socket.on("room:join", ({ code, name, cardBack, rejoinPlayerId }, cb) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: "Room not found" });

    if (rejoinPlayerId) {
      const existing = room.players.find((p) => p.id === rejoinPlayerId);
      if (existing) {
        existing.socketId = socket.id;
        existing.connected = true;
        existing.lastSeen = Date.now();
        currentRoomCode = code;
        currentPlayerId = existing.id;
        socket.join(code);
        cb && cb({ ok: true, code, playerId: existing.id });
        broadcast(room);
        return;
      }
    }

    // Allow joining a started game as spectator
    const playerId = newPlayerId();
    room.players.push({ id: playerId, socketId: socket.id, name: (name || "Player").slice(0, 24),
      connected: true, ready: !!(!room.started), cardBack: cardBack || "classic-blue", lastSeen: Date.now(), spectatorOnly: !!room.started });
    currentRoomCode = code;
    currentPlayerId = playerId;
    socket.join(code);
    cb && cb({ ok: true, code, playerId });
    broadcast(room);
  });

  socket.on("player:heartbeat", () => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const p = room.players.find((x) => x.id === currentPlayerId);
    if (p) p.lastSeen = Date.now();
  });

  socket.on("room:kick", ({ playerId: targetId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId) return;
    const target = room.players.find((p) => p.id === targetId);
    if (!target || target.id === currentPlayerId) return;
    if (target.socketId) {
      const s = io.sockets.sockets.get(target.socketId);
      if (s) {
        s.emit("player:kicked", { reason: "You were kicked by the host." });
        s.disconnect(true);
      }
    }
    if (room.started && room.game) {
      // Remove from active game
      room.game.playerIds = room.game.playerIds.filter((id) => id !== targetId);
      if (!room.game.eliminated.includes(targetId)) room.game.eliminated.push(targetId);
      if (room.game.currentTurnPlayerId === targetId) {
        // advance turn
        const remaining = room.game.playerIds.filter((id) => !room.game.eliminated.includes(id));
        room.game.currentTurnPlayerId = remaining[0] || null;
      }
    }
    room.players = room.players.filter((p) => p.id !== targetId);
    broadcast(room);
  });

  socket.on("player:setReady", ({ ready }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.started) return;
    const p = room.players.find((x) => x.id === currentPlayerId);
    if (p) { p.ready = !!ready; broadcast(room); }
  });

  socket.on("player:setCardBack", ({ cardBack }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const p = room.players.find((x) => x.id === currentPlayerId);
    if (p && typeof cardBack === "string") { p.cardBack = cardBack; broadcast(room); }
  });

  socket.on("room:settings", (s) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId || room.started) return;
    if (s.mode === "setpoints" || s.mode === "elimination") room.settings.mode = s.mode;
    if (Number.isFinite(s.pointLimit) && s.pointLimit > 0) room.settings.pointLimit = Math.floor(s.pointLimit);
    if ([0, 30, 60].includes(s.turnTimer)) room.settings.turnTimer = s.turnTimer;
    if (typeof s.showHandsToSpectators === "boolean") room.settings.showHandsToSpectators = s.showHandsToSpectators;
    if (s.rules && typeof s.rules === "object") {
      const r = room.settings.rules;
      const i = s.rules;
      for (const k of ["allowTriplets", "allow4Seq", "allow6PlusSeq", "allowWrapAround", "acesHigh"])
        if (typeof i[k] === "boolean") r[k] = i[k];
      if (Number.isFinite(i.declarationPenalty) && i.declarationPenalty >= 0) r.declarationPenalty = Math.floor(i.declarationPenalty);
      if (Number.isFinite(i.startingHandSize) && i.startingHandSize >= 3 && i.startingHandSize <= 10) r.startingHandSize = Math.floor(i.startingHandSize);
    }
    broadcast(room);
  });

  socket.on("room:start", () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId || room.started) return;
    if (room.players.length < 2) return;
    if (!room.players.every((p) => p.ready)) return;
    room.started = true;
    room.game = createGame(room.players.map((p) => p.id), room.settings);
    room.game.log.push({ t: Date.now(), msg: `Game started! ${nameOf(room, room.game.currentTurnPlayerId)} goes first.` });
    startTimer(room);
    broadcast(room);
  });

  socket.on("game:action", (action, cb) => {
    const room = rooms.get(currentRoomCode);
    if (!room || !room.game) return cb && cb({ ok: false, error: "No game" });
    const game = room.game;
    if (game.phase !== "playing") return cb && cb({ ok: false, error: "Not in play phase" });
    if (game.currentTurnPlayerId !== currentPlayerId) return cb && cb({ ok: false, error: "Not your turn" });

    const result = applyAction(game, currentPlayerId, action);
    if (!result.ok) return cb && cb({ ok: false, error: result.error });

    game.log.push({ t: Date.now(), msg: result.message.replace("{you}", nameOf(room, currentPlayerId)) });
    if (game.phase === "playing") startTimer(room);
    else clearTimer(room);
    broadcast(room);
    cb && cb({ ok: true });
  });

  socket.on("game:nextRound", () => {
    const room = rooms.get(currentRoomCode);
    if (!room || !room.game || room.hostId !== currentPlayerId || room.game.phase !== "roundEnd") return;
    const activeIds = room.players.map((p) => p.id).filter((id) => !room.game.eliminated.includes(id));
    if (activeIds.length <= 1) return;
    const prev = room.game;
    const newGame = createGame(activeIds, room.settings, {
      cumulativeScores: prev.cumulativeScores, eliminated: prev.eliminated,
      stats: prev.stats, roundNumber: prev.roundNumber,
    });
    newGame.log = prev.log.slice(-20);
    newGame.log.push({ t: Date.now(), msg: `Round ${newGame.roundNumber} starts. ${nameOf(room, newGame.currentTurnPlayerId)} goes first.` });
    room.game = newGame;
    startTimer(room);
    broadcast(room);
  });

  socket.on("game:resetLobby", () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== currentPlayerId) return;
    clearTimer(room);
    room.started = false;
    room.game = null;
    for (const p of room.players) p.ready = false;
    broadcast(room);
  });

  socket.on("chat:send", ({ text }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const p = room.players.find((x) => x.id === currentPlayerId);
    if (!p) return;
    text = String(text || "").trim().slice(0, 200);
    if (!text) return;
    room.chat.push({ from: p.name, text, t: Date.now() });
    broadcast(room);
  });

  socket.on("disconnect", () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const p = room.players.find((x) => x.id === currentPlayerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;

    if (room.hostId === currentPlayerId) {
      const next = room.players.find((x) => x.connected);
      if (next) {
        room.hostId = next.id;
        if (room.game) room.game.log.push({ t: Date.now(), msg: `${next.name} is the new host.` });
      }
    }

    broadcast(room);

    if (!room.players.some((x) => x.connected)) {
      const codeSnapshot = currentRoomCode;
      setTimeout(() => {
        const r = rooms.get(codeSnapshot);
        if (r && !r.players.some((x) => x.connected)) {
          clearTimer(r);
          rooms.delete(codeSnapshot);
        }
      }, 5 * 60 * 1000);
    }
  });
});

server.listen(PORT, () => console.log(`Less Score on :${PORT}`));
