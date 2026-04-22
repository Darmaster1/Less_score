// Less Score — client
const socket = io({ transports: ["websocket", "polling"] });

const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED_SUITS = new Set(["H", "D"]);
const RANK_NAME = (r) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[r] || String(r));

const CARD_BACKS = [
  { id: "classic-blue", name: "Blue" },
  { id: "classic-red", name: "Red" },
  { id: "classic-green", name: "Green" },
  { id: "purple", name: "Purple" },
  { id: "dark", name: "Slate" },
  { id: "gold", name: "Gold" },
];

const state = {
  view: "home", // home | lobby | game
  code: null,
  playerId: null,
  room: null,
  selected: new Set(),
  drawChoice: null,
  drawCardId: null,
  modal: null, // 'rules' | 'cardback' | 'rules-settings' | null
  myCardBack: localStorage.getItem("ls_cardback") || "classic-blue",
};

function saveSession() {
  if (state.code && state.playerId) {
    sessionStorage.setItem("ls_code", state.code);
    sessionStorage.setItem("ls_pid", state.playerId);
  }
}
function clearSession() {
  sessionStorage.removeItem("ls_code");
  sessionStorage.removeItem("ls_pid");
}

socket.on("connect", () => {
  const code = sessionStorage.getItem("ls_code");
  const pid = sessionStorage.getItem("ls_pid");
  if (code && pid && !state.code) {
    socket.emit("room:join", { code, rejoinPlayerId: pid, cardBack: state.myCardBack }, (res) => {
      if (res && res.ok) {
        state.code = res.code;
        state.playerId = res.playerId;
      } else {
        clearSession();
      }
      render();
    });
  }
});

socket.on("room:state", (room) => {
  state.room = room;
  state.view = room.game ? "game" : "lobby";
  if (room.game) {
    if (room.game.currentTurnPlayerId !== room.youId) {
      state.selected.clear();
      state.drawChoice = null;
      state.drawCardId = null;
    }
  }
  render();
});

// =============== ROUTING ===============

function render() {
  const root = document.getElementById("app");
  root.innerHTML = "";
  if (state.view === "home") root.appendChild(renderHome());
  else if (state.view === "lobby") root.appendChild(renderLobby());
  else if (state.view === "game") root.appendChild(renderGame());
  if (state.modal) root.appendChild(renderModal());
}

// =============== HOME ===============

function renderHome() {
  const wrap = el("div", "center");
  const card = el("div", "card-ui home-card");
  card.innerHTML = `
    <h1 style="text-align:center">Less Score</h1>
    <p style="text-align:center;color:#a5b4fc;margin-top:0">Real-time online card duels — outsmart, outscore, declare.</p>
    <div class="tabs">
      <button id="tab-create" class="active">Create Room</button>
      <button id="tab-join">Join Room</button>
    </div>
    <div id="form-create" class="col">
      <label>Your name</label>
      <input id="create-name" placeholder="e.g. Alex" maxlength="20" />
      <button id="create-btn">Create New Room</button>
    </div>
    <div id="form-join" class="col" style="display:none">
      <label>Your name</label>
      <input id="join-name" placeholder="e.g. Alex" maxlength="20" />
      <label>Room code</label>
      <input id="join-code" placeholder="ABCDE" maxlength="5" style="text-transform:uppercase;letter-spacing:0.2em;text-align:center;font-family:monospace" />
      <button id="join-btn">Join Room</button>
    </div>
  `;
  wrap.appendChild(card);

  card.querySelector("#tab-create").onclick = () => {
    card.querySelector("#tab-create").classList.add("active");
    card.querySelector("#tab-join").classList.remove("active");
    card.querySelector("#form-create").style.display = "";
    card.querySelector("#form-join").style.display = "none";
  };
  card.querySelector("#tab-join").onclick = () => {
    card.querySelector("#tab-join").classList.add("active");
    card.querySelector("#tab-create").classList.remove("active");
    card.querySelector("#form-create").style.display = "none";
    card.querySelector("#form-join").style.display = "";
    const url = new URL(location.href);
    const c = url.searchParams.get("code");
    if (c) card.querySelector("#join-code").value = c.toUpperCase();
  };

  const url = new URL(location.href);
  if (url.searchParams.get("code")) card.querySelector("#tab-join").click();

  card.querySelector("#create-btn").onclick = () => {
    const name = card.querySelector("#create-name").value.trim() || "Host";
    socket.emit("room:create", { name, cardBack: state.myCardBack }, (res) => {
      if (res && res.ok) {
        state.code = res.code;
        state.playerId = res.playerId;
        saveSession();
      }
    });
  };
  card.querySelector("#join-btn").onclick = () => {
    const name = card.querySelector("#join-name").value.trim() || "Player";
    const code = card.querySelector("#join-code").value.trim().toUpperCase();
    if (!code) return alert("Enter a room code");
    socket.emit("room:join", { code, name, cardBack: state.myCardBack }, (res) => {
      if (res && res.ok) {
        state.code = res.code;
        state.playerId = res.playerId;
        saveSession();
      } else if (res) {
        alert(res.error || "Failed to join");
      }
    });
  };
  return wrap;
}

// =============== LOBBY ===============

function renderLobby() {
  const room = state.room;
  const me = room.players.find((p) => p.id === room.youId) || {};
  const isHost = room.youId === room.hostId;
  const allReady = room.players.length >= 2 && room.players.every((p) => p.ready);
  const wrap = el("div", "container col");

  const inviteUrl = `${location.origin}${location.pathname}?code=${room.code}`;

  const top = el("div", "card-ui col");
  top.innerHTML = `
    <h1 style="text-align:center">Lobby</h1>
    <div class="code-display">${room.code}</div>
    <div class="row" style="justify-content:center">
      <button class="ghost" id="copy-code">Copy code</button>
      <button class="ghost" id="copy-link">Copy invite link</button>
      <button class="ghost" id="cardback-btn">Card back: ${cardBackName(me.cardBack)}</button>
      <button class="ghost icon" id="rules-help">? Rules</button>
      <button class="ghost danger" id="leave">Leave</button>
    </div>
    <small style="text-align:center">Share the code or link with friends and family. They can join from any device — phone or laptop.</small>
  `;
  wrap.appendChild(top);

  top.querySelector("#copy-code").onclick = () => copyToClipboard(room.code);
  top.querySelector("#copy-link").onclick = () => copyToClipboard(inviteUrl);
  top.querySelector("#cardback-btn").onclick = () => { state.modal = "cardback"; render(); };
  top.querySelector("#rules-help").onclick = () => { state.modal = "rules"; render(); };
  top.querySelector("#leave").onclick = () => { clearSession(); location.href = location.pathname; };

  // Players
  const playersCard = el("div", "card-ui col");
  playersCard.innerHTML = `<div class="section-title"><span>Players (${room.players.length})</span><small>${allReady ? "Everyone ready ✓" : "Waiting for ready"}</small></div>`;
  const list = el("div", "row");
  for (const p of room.players) {
    const pill = el("span", "player-pill" + (p.ready ? " ready" : ""));
    pill.innerHTML = `
      <span class="dot ${p.connected ? "" : "off"}"></span>
      ${escapeHtml(p.name)}${p.id === room.youId ? " (you)" : ""}
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ""}
      ${p.ready ? '<span class="ready-badge">READY</span>' : ""}
    `;
    list.appendChild(pill);
  }
  playersCard.appendChild(list);

  // Ready button
  const readyBtn = el("button", me.ready ? "ghost" : "success");
  readyBtn.textContent = me.ready ? "Cancel Ready" : "I'm Ready";
  readyBtn.onclick = () => socket.emit("player:setReady", { ready: !me.ready });
  playersCard.appendChild(readyBtn);
  wrap.appendChild(playersCard);

  // Host: game settings
  const settingsCard = el("div", "card-ui col");
  settingsCard.innerHTML = `<div class="section-title"><span>Game Settings ${isHost ? "" : "(host only)"}</span><button class="ghost icon" id="open-rules-settings">${isHost ? "Customize Rules" : "View Rules"}</button></div>`;
  settingsCard.querySelector("#open-rules-settings").onclick = () => { state.modal = "rules-settings"; render(); };

  const grid = el("div", "col");
  grid.innerHTML = `
    <label>Mode</label>
    <select id="mode" ${isHost ? "" : "disabled"}>
      <option value="setpoints" ${room.settings.mode === "setpoints" ? "selected" : ""}>Set Points (last to reach limit wins)</option>
      <option value="elimination" ${room.settings.mode === "elimination" ? "selected" : ""}>Elimination (highest each round out)</option>
    </select>

    <div id="limit-wrap" style="display:${room.settings.mode === "setpoints" ? "" : "none"}">
      <label>Point limit</label>
      <input id="limit" type="number" min="10" value="${room.settings.pointLimit}" ${isHost ? "" : "disabled"} />
    </div>

    <label>Turn timer</label>
    <select id="timer" ${isHost ? "" : "disabled"}>
      <option value="0" ${room.settings.turnTimer === 0 ? "selected" : ""}>No timer</option>
      <option value="30" ${room.settings.turnTimer === 30 ? "selected" : ""}>30 seconds</option>
      <option value="60" ${room.settings.turnTimer === 60 ? "selected" : ""}>60 seconds</option>
    </select>
  `;
  settingsCard.appendChild(grid);

  const startNote = !allReady ? `<small>Waiting for all players to ready up.</small>` : "";
  if (isHost) {
    const startBtn = el("button", "");
    startBtn.id = "start";
    startBtn.disabled = !allReady;
    startBtn.textContent = allReady ? "Start Game" : (room.players.length < 2 ? "Need at least 2 players" : "All players must be ready");
    startBtn.onclick = () => socket.emit("room:start");
    settingsCard.appendChild(startBtn);
  } else {
    const w = el("small"); w.textContent = "Waiting for host to start…";
    settingsCard.appendChild(w);
  }
  if (startNote && isHost) {
    const w = el("small"); w.innerHTML = startNote;
    settingsCard.appendChild(w);
  }
  wrap.appendChild(settingsCard);

  if (isHost) {
    const send = () => {
      socket.emit("room:settings", {
        mode: grid.querySelector("#mode").value,
        pointLimit: Number(grid.querySelector("#limit").value || 100),
        turnTimer: Number(grid.querySelector("#timer").value),
      });
    };
    grid.querySelector("#mode").onchange = send;
    grid.querySelector("#limit").onchange = send;
    grid.querySelector("#timer").onchange = send;
  }

  wrap.appendChild(renderChat());
  return wrap;
}

// =============== GAME ===============

function renderGame() {
  const room = state.room;
  const game = room.game;
  const wrap = el("div", "container col");

  // Top header bar
  const header = el("div", "row");
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.innerHTML = `<h2 style="margin:0">Less Score · Round ${game.roundNumber}</h2>`;
  const headerActions = el("div", "row");
  const helpBtn = el("button", "ghost icon"); helpBtn.textContent = "? Rules";
  helpBtn.onclick = () => { state.modal = "rules"; render(); };
  headerActions.appendChild(helpBtn);
  header.appendChild(headerActions);
  wrap.appendChild(header);

  if (game.phase === "gameEnd") {
    wrap.appendChild(renderGameEnd(room, game));
    wrap.appendChild(renderChat());
    return wrap;
  }

  // Turn banner
  const yourTurn = game.currentTurnPlayerId === room.youId && !game.isSpectator;
  const currName = nameOf(room, game.currentTurnPlayerId);
  const banner = el("div", `turn-banner ${yourTurn ? "you" : ""}`);
  let timerText = "";
  if (game.turnEndsAt && game.phase === "playing") {
    const remaining = Math.max(0, Math.ceil((game.turnEndsAt - Date.now()) / 1000));
    timerText = `<span class="timer">⏱ ${remaining}s</span>`;
  }
  banner.innerHTML = `<div><b>${yourTurn ? "Your turn" : currName + "'s turn"}</b>${game.isSpectator ? ' <span class="spec-badge">SPECTATING</span>' : ""}</div>${timerText}`;
  wrap.appendChild(banner);

  if (game.phase === "roundEnd") wrap.appendChild(renderRoundEnd(room, game));

  const board = el("div", "board");
  board.appendChild(renderLeftCol(room, game, yourTurn));
  board.appendChild(renderRightCol(room, game));
  wrap.appendChild(board);

  wrap.appendChild(renderChat());

  if (game.turnEndsAt && game.phase === "playing") {
    clearTimeout(window.__tt);
    window.__tt = setTimeout(render, 1000);
  }

  return wrap;
}

function renderLeftCol(room, game, yourTurn) {
  const col = el("div", "col");
  const piles = el("div", "row");

  // Draw pile
  const draw = el("div", "pile");
  draw.innerHTML = `<div class="label">Draw pile (${game.drawPileCount})</div>`;
  const drawCards = el("div", "discard-cards");
  drawCards.appendChild(makeCardEl(null, { faceDown: true, cardBack: myCardBack(room) }));
  draw.appendChild(drawCards);
  if (yourTurn && game.phase === "playing" && state.selected.size > 0) {
    const btn = el("button", state.drawChoice === "deck" ? "success" : "");
    btn.textContent = state.drawChoice === "deck" ? "✓ Drawing from deck" : "Draw from deck";
    btn.onclick = () => { state.drawChoice = "deck"; state.drawCardId = null; render(); };
    draw.appendChild(btn);
  }
  piles.appendChild(draw);

  // Discard pile (only show last set)
  const disc = el("div", "pile");
  disc.style.flex = "1";
  const lastByName = game.lastDiscardBy ? nameOf(room, game.lastDiscardBy) : null;
  let discLabel = `Last discard${lastByName ? " — " + lastByName : ""}`;
  if (game.lastDiscardWasSequence && game.lastDiscardBy && game.lastDiscardBy !== room.youId) {
    discLabel += " · pick any card from sequence";
  }
  disc.innerHTML = `<div class="label">${discLabel}</div>`;
  const discCards = el("div", "discard-cards");
  const visibleSet = game.visibleDiscard || [];
  visibleSet.forEach((c, idx) => {
    const cEl = makeCardEl(c);
    if (yourTurn && game.phase === "playing" && state.selected.size > 0 && game.lastDiscardBy && game.lastDiscardBy !== room.youId) {
      if (game.lastDiscardWasSequence) {
        cEl.style.cursor = "pointer";
        cEl.onclick = () => { state.drawChoice = "discard"; state.drawCardId = c.id; render(); };
        if (state.drawCardId === c.id) cEl.classList.add("selected");
      } else if (idx === visibleSet.length - 1) {
        cEl.style.cursor = "pointer";
        cEl.onclick = () => { state.drawChoice = "discard"; state.drawCardId = c.id; render(); };
        if (state.drawCardId === c.id) cEl.classList.add("selected");
      }
    }
    discCards.appendChild(cEl);
  });
  disc.appendChild(discCards);
  piles.appendChild(disc);

  col.appendChild(piles);

  // Spectator: show all hands if enabled
  if (game.isSpectator && game.allHands) {
    const spec = el("div", "card-ui");
    spec.innerHTML = `<div class="section-title"><span>All hands (spectator view)</span></div>`;
    for (const [pid, h] of Object.entries(game.allHands)) {
      const sec = el("div", "");
      sec.innerHTML = `<div style="margin-top:8px"><b>${escapeHtml(nameOf(room, pid))}</b> — ${handTotalOf(h)} pts</div>`;
      const handDiv = el("div", "hand");
      h.slice().sort((a, b) => a.rank - b.rank).forEach((c) => handDiv.appendChild(makeCardEl(c)));
      sec.appendChild(handDiv);
      spec.appendChild(sec);
    }
    col.appendChild(spec);
  } else if (room.youId && game.yourHand && !game.eliminated.includes(room.youId)) {
    const handCard = el("div", "card-ui");
    const sortedHand = game.yourHand.slice().sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
    const total = handTotalOf(sortedHand);
    handCard.innerHTML = `<div class="section-title"><span>Your hand · total ${total} pts</span></div>`;
    const hand = el("div", "hand");
    for (const c of sortedHand) {
      const cEl = makeCardEl(c);
      if (yourTurn && game.phase === "playing") {
        if (state.selected.has(c.id)) cEl.classList.add("selected");
        cEl.onclick = () => {
          if (state.selected.has(c.id)) state.selected.delete(c.id);
          else state.selected.add(c.id);
          state.drawChoice = null;
          state.drawCardId = null;
          render();
        };
      }
      hand.appendChild(cEl);
    }
    handCard.appendChild(hand);
    col.appendChild(handCard);

    if (yourTurn && game.phase === "playing") {
      const bar = el("div", "action-bar");

      const declareBtn = el("button", "danger");
      declareBtn.textContent = "🎯 Declare";
      declareBtn.disabled = state.selected.size > 0;
      declareBtn.onclick = () => {
        if (!confirm("Declare that you have the lowest hand?")) return;
        socket.emit("game:action", { type: "declare" }, (r) => { if (!r.ok) alert(r.error); });
      };
      bar.appendChild(declareBtn);

      const playBtn = el("button", "success");
      playBtn.textContent = `Play ${state.selected.size} card${state.selected.size === 1 ? "" : "s"}`;
      const ready = state.selected.size > 0 && state.drawChoice && (state.drawChoice === "deck" || state.drawCardId);
      playBtn.disabled = !ready;
      playBtn.onclick = () => {
        const cardIds = [...state.selected];
        const draw = state.drawChoice === "deck" ? { source: "deck" } : { source: "discard", cardId: state.drawCardId };
        socket.emit("game:action", { type: "discard", cardIds, draw }, (r) => {
          if (!r.ok) { alert(r.error); return; }
          state.selected.clear();
          state.drawChoice = null;
          state.drawCardId = null;
        });
      };
      bar.appendChild(playBtn);

      if (state.selected.size > 0) {
        const clr = el("button", "ghost");
        clr.textContent = "Clear selection";
        clr.onclick = () => {
          state.selected.clear();
          state.drawChoice = null;
          state.drawCardId = null;
          render();
        };
        bar.appendChild(clr);
      }

      col.appendChild(bar);

      if (state.selected.size > 0 && !state.drawChoice) {
        const hint = el("div", "banner-warn");
        hint.style.marginTop = "8px";
        hint.textContent = game.lastDiscardBy && game.lastDiscardBy !== room.youId
          ? "Now choose where to draw from: the deck, or a card from the previous discard."
          : "Now choose where to draw from. (Discard pickup not available — no previous discard yet.)";
        col.appendChild(hint);
      }
    }
  } else if (game.eliminated.includes(room.youId)) {
    const c = el("div", "banner-warn");
    c.textContent = `You're eliminated. Watching as a spectator${game.showHandsToSpectators ? " — host has enabled visible hands." : "."}`;
    col.appendChild(c);
  }

  return col;
}

function renderRightCol(room, game) {
  const col = el("div", "col");

  const sc = el("div", "card-ui");
  sc.innerHTML = `<div class="section-title"><span>Players</span></div>`;
  sc.appendChild(renderScores(room, game, false));
  col.appendChild(sc);

  const logCard = el("div", "card-ui");
  logCard.innerHTML = `<div class="section-title"><span>Game log</span></div>`;
  const log = el("div", "log");
  for (const e of game.log) {
    const row = el("div", "entry");
    row.textContent = e.msg;
    log.appendChild(row);
  }
  logCard.appendChild(log);
  col.appendChild(logCard);

  return col;
}

function renderScores(room, game, finalView) {
  const wrap = el("div", "scores");
  for (const p of room.players) {
    const isElim = game.eliminated.includes(p.id);
    const isCurrent = !finalView && game.currentTurnPlayerId === p.id && game.phase === "playing";
    const row = el("div", `score-row ${isElim ? "eliminated" : ""} ${isCurrent ? "current" : ""}`);
    const cumScore = game.cumulativeScores[p.id] ?? 0;
    const handCount = game.handCounts[p.id] ?? 0;
    let right = "";
    if (game.mode === "setpoints") right = `${cumScore} / ${game.pointLimit} pts`;
    else right = isElim ? "OUT" : `${handCount} cards`;
    if (game.lastRoundScores && game.lastRoundScores[p.id] !== undefined) {
      right = `+${game.lastRoundScores[p.id]} → ${cumScore}` + (game.mode === "setpoints" ? ` / ${game.pointLimit}` : "");
    }
    row.innerHTML = `
      <span>
        <span class="dot ${p.connected ? "" : "off"}"></span>
        ${escapeHtml(p.name)}${p.id === room.youId ? " (you)" : ""}
        ${p.isHost ? ' <span class="host-badge">H</span>' : ""}
        ${isElim ? ' <span class="spec-badge">SPEC</span>' : ""}
      </span>
      <span>${right}</span>
    `;
    wrap.appendChild(row);
  }
  return wrap;
}

function renderRoundEnd(room, game) {
  const card = el("div", "card-ui col");
  const detail = game.roundEndDetail || {};
  const decName = nameOf(room, game.declarerId);
  let title = "Round Ended";
  let desc = "";
  if (detail.case === "declarerLowest") {
    title = `${decName} declared and won the round!`;
    desc = "Declarer scores 0. Others score their hand totals.";
  } else if (detail.case === "tie") {
    title = `${decName} declared — tied for lowest.`;
    desc = "Declarer scores 0. Tied players keep their actual hand totals.";
  } else if (detail.case === "penalty") {
    const lowName = (detail.lowestPids || []).map((id) => nameOf(room, id)).join(", ");
    title = `${decName} declared but ${lowName || "someone else"} had less!`;
    desc = `Declarer takes +${detail.penalty || 50}. ${lowName} scores 0.`;
  }
  card.innerHTML = `<h2 style="text-align:center">${title}</h2><p style="text-align:center;color:#cbd5e1">${desc}</p>`;
  card.appendChild(renderScores(room, game, false));

  if (detail.newlyEliminated && detail.newlyEliminated.length) {
    const names = detail.newlyEliminated.map((id) => nameOf(room, id)).join(", ");
    const e = el("div", "banner-warn");
    e.textContent = `Eliminated: ${names}`;
    card.appendChild(e);
  }

  if (room.youId === room.hostId) {
    const btn = el("button", "success");
    btn.textContent = "Start Next Round";
    btn.onclick = () => socket.emit("game:nextRound");
    card.appendChild(btn);
  } else {
    const w = el("small"); w.textContent = "Waiting for host to start the next round…";
    card.appendChild(w);
  }
  return card;
}

function renderGameEnd(room, game) {
  const card = el("div", "card-ui col");
  const winner = room.players.find((p) => p.id === game.winnerId);
  card.innerHTML = `
    <h1 style="text-align:center">🏆 Game Over</h1>
    <h2 style="text-align:center;color:#fbbf24">${winner ? escapeHtml(winner.name) + " wins!" : "No winner"}</h2>
  `;
  card.appendChild(renderScores(room, game, true));

  // Stats
  const stats = computeAggregateStats(room, game);
  const sg = el("div", "");
  sg.innerHTML = `<h2 style="margin-top:18px">Match Statistics</h2>`;
  const grid = el("div", "stat-grid");
  for (const s of stats) {
    const c = el("div", "stat-card");
    c.innerHTML = `
      <div class="stat-label">${escapeHtml(s.label)}</div>
      <div class="stat-value">${escapeHtml(s.value)}</div>
      ${s.detail ? `<div class="stat-detail">${escapeHtml(s.detail)}</div>` : ""}
    `;
    grid.appendChild(c);
  }
  sg.appendChild(grid);
  card.appendChild(sg);

  if (room.youId === room.hostId) {
    const btn = el("button", "");
    btn.textContent = "Reset Lobby";
    btn.onclick = () => socket.emit("game:resetLobby");
    card.appendChild(btn);
  }
  return card;
}

function computeAggregateStats(room, game) {
  const all = room.players;
  const stats = game.stats || {};
  const out = [];
  const named = (pid) => pid ? nameOf(room, pid) : "—";

  // Lowest average score
  let bestAvg = { pid: null, val: Infinity };
  for (const p of all) {
    const s = stats[p.id]; if (!s || !s.roundsPlayed) continue;
    const avg = s.totalRoundScore / s.roundsPlayed;
    if (avg < bestAvg.val) bestAvg = { pid: p.id, val: avg };
  }
  out.push({ label: "Lowest Average Score", value: named(bestAvg.pid), detail: bestAvg.val !== Infinity ? `${bestAvg.val.toFixed(1)} pts/round` : "" });

  // Most successful declarations
  let mostDecWon = { pid: null, val: -1 };
  for (const p of all) {
    const s = stats[p.id] || {};
    if ((s.declarationsWon || 0) > mostDecWon.val) mostDecWon = { pid: p.id, val: s.declarationsWon || 0 };
  }
  out.push({ label: "Most Successful Declarations", value: named(mostDecWon.pid), detail: `${mostDecWon.val} won` });

  // Most failed declarations (penalty taker)
  let mostFails = { pid: null, val: -1 };
  for (const p of all) {
    const s = stats[p.id] || {};
    if ((s.declarationsFailed || 0) > mostFails.val) mostFails = { pid: p.id, val: s.declarationsFailed || 0 };
  }
  out.push({ label: "Most Risky Declarer", value: named(mostFails.pid), detail: `${mostFails.val} failed declarations` });

  // Best single hand (lowest)
  let bestHand = { pid: null, val: Infinity };
  for (const p of all) {
    const s = stats[p.id] || {};
    if ((s.bestHandTotal ?? Infinity) < bestHand.val) bestHand = { pid: p.id, val: s.bestHandTotal };
  }
  out.push({ label: "Lowest Hand Achieved", value: named(bestHand.pid), detail: bestHand.val !== Infinity ? `${bestHand.val} pts` : "" });

  // Most sequences played
  let mostSeq = { pid: null, val: -1 };
  for (const p of all) {
    const s = stats[p.id] || {};
    if ((s.sequencesPlayed || 0) > mostSeq.val) mostSeq = { pid: p.id, val: s.sequencesPlayed || 0 };
  }
  out.push({ label: "Most Sequences", value: named(mostSeq.pid), detail: `${mostSeq.val} sequences` });

  // Most quads played
  let mostQuads = { pid: null, val: -1 };
  for (const p of all) {
    const s = stats[p.id] || {};
    if ((s.quadsPlayed || 0) > mostQuads.val) mostQuads = { pid: p.id, val: s.quadsPlayed || 0 };
  }
  out.push({ label: "Most Four-of-a-Kinds", value: named(mostQuads.pid), detail: `${mostQuads.val} quads` });

  // Most cards discarded
  let mostDisc = { pid: null, val: -1 };
  for (const p of all) {
    const s = stats[p.id] || {};
    if ((s.cardsDiscarded || 0) > mostDisc.val) mostDisc = { pid: p.id, val: s.cardsDiscarded || 0 };
  }
  out.push({ label: "Most Cards Discarded", value: named(mostDisc.pid), detail: `${mostDisc.val} cards` });

  // Times had lowest hand
  let mostLow = { pid: null, val: -1 };
  for (const p of all) {
    const s = stats[p.id] || {};
    if ((s.timesLowest || 0) > mostLow.val) mostLow = { pid: p.id, val: s.timesLowest || 0 };
  }
  out.push({ label: "Most Often Lowest", value: named(mostLow.pid), detail: `${mostLow.val} rounds` });

  return out;
}

function renderChat() {
  const card = el("div", "card-ui chat");
  card.innerHTML = `<div class="section-title"><span>Chat</span></div>`;
  const list = el("div", "chat-list");
  for (const m of state.room.chat || []) {
    const e = el("div", "");
    e.innerHTML = `<span class="from">${escapeHtml(m.from)}:</span> ${escapeHtml(m.text)}`;
    list.appendChild(e);
  }
  card.appendChild(list);
  setTimeout(() => { list.scrollTop = list.scrollHeight; }, 0);

  const form = el("form", "chat-form");
  form.innerHTML = `<input id="chat-input" placeholder="Say hi…" maxlength="200"/><button>Send</button>`;
  form.onsubmit = (e) => {
    e.preventDefault();
    const i = form.querySelector("#chat-input");
    const text = i.value.trim();
    if (!text) return;
    socket.emit("chat:send", { text });
    i.value = "";
  };
  card.appendChild(form);
  return card;
}

// =============== MODALS ===============

function renderModal() {
  const wrap = el("div", "modal-bg");
  wrap.onclick = (e) => { if (e.target === wrap) { state.modal = null; render(); } };
  const modal = el("div", "modal");
  if (state.modal === "rules") modal.appendChild(renderRulesModalContent());
  else if (state.modal === "cardback") modal.appendChild(renderCardBackModalContent());
  else if (state.modal === "rules-settings") modal.appendChild(renderRulesSettingsModalContent());
  const closeRow = el("div", "close-row");
  const close = el("button", "ghost"); close.textContent = "Close";
  close.onclick = () => { state.modal = null; render(); };
  closeRow.appendChild(close);
  modal.appendChild(closeRow);
  wrap.appendChild(modal);
  return wrap;
}

function renderRulesModalContent() {
  const c = el("div", "");
  c.innerHTML = `
    <h2>How to Play Less Score</h2>
    <p>Each player starts with a hand of cards. The goal: have the <b>lowest hand total</b> when you declare. Aces = 1, JQK = 10, others face value.</p>
    <h2>Each turn, you choose:</h2>
    <ol style="line-height:1.7;padding-left:20px">
      <li><b>Declare</b> — bet that you have the lowest hand. Round ends immediately.</li>
      <li><b>Play</b> — discard a valid set, then draw 1 card from the deck OR the previous player's discard.</li>
    </ol>

    <h2>Valid discard sets</h2>
  `;
  c.appendChild(rulesExample("Single", [{ rank: 5, suit: "H" }]));
  c.appendChild(rulesExample("Pair (two same rank)", [{ rank: 7, suit: "S" }, { rank: 7, suit: "D" }]));
  c.appendChild(rulesExample("Four-of-a-kind", [{ rank: 9, suit: "S" }, { rank: 9, suit: "H" }, { rank: 9, suit: "D" }, { rank: 9, suit: "C" }]));
  c.appendChild(rulesExample("3-card sequence (consecutive)", [{ rank: 4, suit: "S" }, { rank: 5, suit: "H" }, { rank: 6, suit: "D" }]));
  c.appendChild(rulesExample("5-card sequence (consecutive)", [{ rank: 7, suit: "S" }, { rank: 8, suit: "H" }, { rank: 9, suit: "D" }, { rank: 10, suit: "C" }, { rank: 11, suit: "S" }]));

  const extra = el("div", "");
  extra.innerHTML = `
    <p><small>Triplets and 4-card sequences are <b>off by default</b> but the host can enable them in settings.</small></p>
    <h2>Special pickup rule</h2>
    <p>If the previous player discarded a sequence, you may pick <b>any one card</b> from it (not just the top).</p>
    <h2>Declaration scoring</h2>
    <ul style="line-height:1.7;padding-left:20px">
      <li>You're <b>strictly lowest</b> → you score 0, others score their hand totals.</li>
      <li><b>Tie</b> for lowest → you score 0, tied players keep their hand totals.</li>
      <li>Someone is <b>lower than you</b> → you take +50 (or custom penalty), that lowest player scores 0, others keep theirs.</li>
    </ul>
    <h2>Game modes</h2>
    <ul style="line-height:1.7;padding-left:20px">
      <li><b>Set Points</b>: cumulative scoring across rounds. When you reach the limit, you're out. Last one standing wins.</li>
      <li><b>Elimination</b>: each round, the highest-scoring player is eliminated. No cumulative score.</li>
    </ul>
  `;
  c.appendChild(extra);
  return c;
}

function rulesExample(label, cards) {
  const wrap = el("div", "");
  wrap.innerHTML = `<div style="margin-top:10px"><b>${label}</b></div>`;
  const set = el("div", "example-set");
  for (const c of cards) set.appendChild(makeCardEl({ id: "e" + Math.random(), rank: c.rank, suit: c.suit }));
  wrap.appendChild(set);
  return wrap;
}

function renderCardBackModalContent() {
  const me = state.room?.players.find((p) => p.id === state.room.youId) || {};
  const c = el("div", "");
  c.innerHTML = `<h2>Choose your card back</h2><p style="color:#cbd5e1">This is what others see when they look at your face-down deck.</p>`;
  const grid = el("div", "cb-grid");
  for (const cb of CARD_BACKS) {
    const opt = el("div", "cb-option" + (me.cardBack === cb.id ? " selected" : ""));
    opt.appendChild(makeCardEl(null, { faceDown: true, cardBack: cb.id }));
    const n = el("div", "name"); n.textContent = cb.name;
    opt.appendChild(n);
    opt.onclick = () => {
      state.myCardBack = cb.id;
      localStorage.setItem("ls_cardback", cb.id);
      socket.emit("player:setCardBack", { cardBack: cb.id });
    };
    grid.appendChild(opt);
  }
  c.appendChild(grid);
  return c;
}

function renderRulesSettingsModalContent() {
  const room = state.room;
  const isHost = room.youId === room.hostId;
  const r = room.settings.rules;
  const c = el("div", "");
  c.innerHTML = `
    <h2>Custom Rules ${isHost ? "" : "(host only)"}</h2>
    <p style="color:#cbd5e1">Tweak the rules to match your house style. ${isHost ? "" : "Only the host can change these."}</p>
  `;

  // Numeric settings
  const numWrap = el("div", "");
  numWrap.innerHTML = `
    <div class="toggle-row">
      <div>
        <div><b>Starting hand size</b></div>
        <small>How many cards each player starts with (3–10).</small>
      </div>
      <input id="hsize" type="number" min="3" max="10" value="${r.startingHandSize}" style="width:80px" ${isHost ? "" : "disabled"} />
    </div>
    <div class="toggle-row">
      <div>
        <div><b>Declaration penalty</b></div>
        <small>Points added when you wrongly declare.</small>
      </div>
      <input id="dpen" type="number" min="0" max="500" value="${r.declarationPenalty}" style="width:80px" ${isHost ? "" : "disabled"} />
    </div>
  `;
  c.appendChild(numWrap);

  c.appendChild(buildToggleRow("Allow triplets", "Three cards of same rank as a discard.", r.allowTriplets, "allowTriplets", isHost));
  c.appendChild(buildToggleRow("Allow 4-card sequences", "e.g. 4-5-6-7 in any suits.", r.allow4Seq, "allow4Seq", isHost));
  c.appendChild(buildToggleRow("Allow 6+ card sequences", "Long sequences: 6, 7, 8 cards…", r.allow6PlusSeq, "allow6PlusSeq", isHost));
  c.appendChild(buildToggleRow("Allow wrap-around (Q-K-A)", "Sequences can wrap through the Ace as a high card.", r.allowWrapAround, "allowWrapAround", isHost));

  // Spectator visibility
  c.appendChild(buildSettingToggleRow(
    "Spectators see all hands",
    "Eliminated players can see everyone's cards. Adds a fun couch-watching vibe.",
    !!room.settings.showHandsToSpectators,
    "showHandsToSpectators",
    isHost,
  ));

  if (isHost) {
    const send = () => {
      const rules = {
        startingHandSize: Number(numWrap.querySelector("#hsize").value || 5),
        declarationPenalty: Number(numWrap.querySelector("#dpen").value || 50),
      };
      socket.emit("room:settings", { rules });
    };
    numWrap.querySelector("#hsize").onchange = send;
    numWrap.querySelector("#dpen").onchange = send;
  }
  return c;
}

function buildToggleRow(title, desc, value, key, isHost) {
  const row = el("div", "toggle-row");
  row.innerHTML = `
    <div>
      <div><b>${escapeHtml(title)}</b></div>
      <small>${escapeHtml(desc)}</small>
    </div>
  `;
  const tog = el("div", `toggle ${value ? "on" : ""} ${isHost ? "" : "disabled"}`);
  if (isHost) {
    tog.onclick = () => {
      const next = !value;
      socket.emit("room:settings", { rules: { [key]: next } });
    };
  }
  row.appendChild(tog);
  return row;
}

function buildSettingToggleRow(title, desc, value, key, isHost) {
  const row = el("div", "toggle-row");
  row.innerHTML = `
    <div>
      <div><b>${escapeHtml(title)}</b></div>
      <small>${escapeHtml(desc)}</small>
    </div>
  `;
  const tog = el("div", `toggle ${value ? "on" : ""} ${isHost ? "" : "disabled"}`);
  if (isHost) {
    tog.onclick = () => socket.emit("room:settings", { [key]: !value });
  }
  row.appendChild(tog);
  return row;
}

// =============== HELPERS ===============

function nameOf(room, pid) {
  const p = room.players.find((x) => x.id === pid);
  return p ? p.name : "?";
}

function myCardBack(room) {
  const me = room.players.find((p) => p.id === room.youId);
  return (me && me.cardBack) || "classic-blue";
}

function cardBackName(id) {
  const f = CARD_BACKS.find((c) => c.id === id);
  return f ? f.name : "Blue";
}

function handTotalOf(hand) {
  return hand.reduce((s, c) => s + (c.rank <= 10 ? c.rank : 10), 0);
}

function makeCardEl(c, opts = {}) {
  const div = document.createElement("div");
  div.className = "card" + (opts.small ? " small" : "");
  if (opts.faceDown || !c) {
    const back = opts.cardBack || "classic-blue";
    div.classList.add("facedown", "cb-" + back);
    return div;
  }
  if (RED_SUITS.has(c.suit)) div.classList.add("red");
  div.innerHTML = `<div class="rank">${RANK_NAME(c.rank)}<br><span style="font-size:.85em">${SUIT_SYMBOLS[c.suit]}</span></div><div class="suit">${SUIT_SYMBOLS[c.suit]}</div>`;
  return div;
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => alert("Copied!")).catch(() => prompt("Copy:", text));
}

render();
