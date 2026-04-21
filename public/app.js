// Least Score — client
const socket = io({ transports: ["websocket", "polling"] });

const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED_SUITS = new Set(["H", "D"]);

const state = {
  view: "home", // home | lobby | game
  code: null,
  playerId: null,
  room: null,
  selected: new Set(), // selected card ids
  drawChoice: null, // 'deck' | 'discard'
  drawCardId: null,
  showDeclareConfirm: false,
};

// Persist player id for rejoin
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
  // try rejoin from session
  const code = sessionStorage.getItem("ls_code");
  const pid = sessionStorage.getItem("ls_pid");
  if (code && pid && !state.code) {
    socket.emit("room:join", { code, rejoinPlayerId: pid }, (res) => {
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
  // clear selection if not your turn
  if (room.game) {
    if (room.game.currentTurnPlayerId !== room.youId) {
      state.selected.clear();
      state.drawChoice = null;
      state.drawCardId = null;
    }
  }
  render();
});

// ============ ROUTING ============

function render() {
  const root = document.getElementById("app");
  root.innerHTML = "";
  if (state.view === "home") root.appendChild(renderHome());
  else if (state.view === "lobby") root.appendChild(renderLobby());
  else if (state.view === "game") root.appendChild(renderGame());
}

// ============ HOME ============

function renderHome() {
  const wrap = el("div", "center");
  const card = el("div", "card-ui home-card");
  card.innerHTML = `
    <h1 style="text-align:center">🃏 Least Score</h1>
    <p style="text-align:center;color:#a5b4fc;margin-top:0">Family card game · play in real time</p>
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

  // Tab toggling
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
    // pre-fill from URL ?code=
    const url = new URL(location.href);
    const c = url.searchParams.get("code");
    if (c) card.querySelector("#join-code").value = c.toUpperCase();
  };

  // Pre-fill if URL has ?code=
  const url = new URL(location.href);
  if (url.searchParams.get("code")) {
    card.querySelector("#tab-join").click();
  }

  card.querySelector("#create-btn").onclick = () => {
    const name = card.querySelector("#create-name").value.trim() || "Host";
    socket.emit("room:create", { name }, (res) => {
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
    socket.emit("room:join", { code, name }, (res) => {
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

// ============ LOBBY ============

function renderLobby() {
  const room = state.room;
  const isHost = room.youId === room.hostId;
  const wrap = el("div", "container col");

  const inviteUrl = `${location.origin}${location.pathname}?code=${room.code}`;

  const top = el("div", "card-ui col");
  top.innerHTML = `
    <h1 style="text-align:center">Lobby</h1>
    <div class="code-display" id="code-display">${room.code}</div>
    <div class="row" style="justify-content:center">
      <button class="ghost" id="copy-code">Copy code</button>
      <button class="ghost" id="copy-link">Copy invite link</button>
      <button class="ghost danger" id="leave">Leave</button>
    </div>
    <small style="text-align:center">Share the code or link with friends and family. They can join from any device — phone or laptop.</small>
  `;
  wrap.appendChild(top);

  top.querySelector("#copy-code").onclick = () => copyToClipboard(room.code);
  top.querySelector("#copy-link").onclick = () => copyToClipboard(inviteUrl);
  top.querySelector("#leave").onclick = () => {
    clearSession(); location.href = location.pathname;
  };

  const playersCard = el("div", "card-ui col");
  playersCard.innerHTML = `<div class="section-title">Players (${room.players.length})</div>`;
  const list = el("div", "row");
  for (const p of room.players) {
    const pill = el("span", "player-pill");
    pill.innerHTML = `
      <span class="dot ${p.connected ? "" : "off"}"></span>
      ${escapeHtml(p.name)}${p.id === room.youId ? " (you)" : ""}
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ""}
    `;
    list.appendChild(pill);
  }
  playersCard.appendChild(list);
  wrap.appendChild(playersCard);

  // Host controls
  const hostCard = el("div", "card-ui col");
  hostCard.innerHTML = `<div class="section-title">Game Settings ${isHost ? "" : "(host only)"}</div>`;
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

    ${isHost ? `<button id="start" ${room.players.length < 2 ? "disabled" : ""}>${room.players.length < 2 ? "Need at least 2 players" : "Start Game"}</button>` : `<small>Waiting for host to start…</small>`}
  `;
  hostCard.appendChild(grid);
  wrap.appendChild(hostCard);

  if (isHost) {
    const send = () => {
      const mode = grid.querySelector("#mode").value;
      const pointLimit = Number(grid.querySelector("#limit").value || 100);
      const turnTimer = Number(grid.querySelector("#timer").value);
      socket.emit("room:settings", { mode, pointLimit, turnTimer });
    };
    grid.querySelector("#mode").onchange = send;
    grid.querySelector("#limit").onchange = send;
    grid.querySelector("#timer").onchange = send;
    grid.querySelector("#start").onclick = () => socket.emit("room:start");
  }

  // Rules summary
  const rules = el("div", "card-ui");
  rules.innerHTML = `
    <div class="section-title">Quick Rules</div>
    <ul style="margin:6px 0;padding-left:20px;line-height:1.6;font-size:.9rem;color:#cbd5e1">
      <li>5 cards each. Aces = 1, JQK = 10, others = face value.</li>
      <li>Each turn: <b>Declare</b> (lowest hand wins) <i>or</i> <b>play</b>: discard a valid set, then draw 1.</li>
      <li>Valid discards: single, pair, four-of-a-kind, 3-card sequence, 5-card sequence (no triplets, no 4-card sequence, no wrap-around).</li>
      <li>If the last discard was a sequence, you may pick any card from it.</li>
      <li>Declarer is lowest → 0 pts. Tie → declarer 0, others keep theirs. Someone lower → declarer +50, lowest player → 0.</li>
    </ul>
  `;
  wrap.appendChild(rules);

  // Chat
  wrap.appendChild(renderChat());

  return wrap;
}

// ============ GAME ============

function renderGame() {
  const room = state.room;
  const game = room.game;
  const wrap = el("div", "container col");

  // Game end
  if (game.phase === "gameEnd") {
    const card = el("div", "card-ui col");
    const winner = room.players.find((p) => p.id === game.winnerId);
    card.innerHTML = `
      <h1 style="text-align:center">🏆 Game Over</h1>
      <h2 style="text-align:center;color:#fbbf24">${winner ? escapeHtml(winner.name) + " wins!" : "No winner"}</h2>
    `;
    card.appendChild(renderScores(room, game, true));
    if (room.youId === room.hostId) {
      const btn = el("button", "");
      btn.textContent = "Reset Lobby";
      btn.onclick = () => socket.emit("game:resetLobby");
      card.appendChild(btn);
    }
    wrap.appendChild(card);
    wrap.appendChild(renderChat());
    return wrap;
  }

  // Turn banner
  const yourTurn = game.currentTurnPlayerId === room.youId;
  const currName = nameOf(room, game.currentTurnPlayerId);
  const banner = el("div", `turn-banner ${yourTurn ? "you" : ""}`);
  let timerText = "";
  if (game.turnEndsAt && game.phase === "playing") {
    const remaining = Math.max(0, Math.ceil((game.turnEndsAt - Date.now()) / 1000));
    timerText = `<span class="timer">⏱ ${remaining}s</span>`;
  }
  banner.innerHTML = `<div><b>${yourTurn ? "Your turn" : currName + "'s turn"}</b></div>${timerText}`;
  wrap.appendChild(banner);

  // Round end overlay (in-flow)
  if (game.phase === "roundEnd") {
    wrap.appendChild(renderRoundEnd(room, game));
  }

  // Board
  const board = el("div", "board");
  board.appendChild(renderLeftCol(room, game, yourTurn));
  board.appendChild(renderRightCol(room, game));
  wrap.appendChild(board);

  // Chat
  wrap.appendChild(renderChat());

  // Re-render every second to update timer
  if (game.turnEndsAt && game.phase === "playing") {
    clearTimeout(window.__tt);
    window.__tt = setTimeout(render, 1000);
  }

  return wrap;
}

function renderLeftCol(room, game, yourTurn) {
  const col = el("div", "col");

  // Piles
  const piles = el("div", "row");
  // Draw pile
  const draw = el("div", "pile");
  draw.innerHTML = `<div class="label">Draw pile (${game.drawPileCount})</div>`;
  const drawCards = el("div", "discard-cards");
  drawCards.appendChild(makeCardEl(null, { faceDown: true }));
  draw.appendChild(drawCards);
  if (yourTurn && game.phase === "playing" && state.selected.size > 0) {
    const btn = el("button", "");
    btn.textContent = state.drawChoice === "deck" ? "✓ Drawing from deck" : "Draw from deck";
    btn.onclick = () => { state.drawChoice = "deck"; state.drawCardId = null; render(); };
    if (state.drawChoice === "deck") btn.classList.add("success");
    draw.appendChild(btn);
  }
  piles.appendChild(draw);

  // Discard pile
  const disc = el("div", "pile");
  disc.style.flex = "1";
  let discLabel = "Discard pile";
  if (game.lastDiscardWasSequence) discLabel += ` — sequence! pick any card from it`;
  disc.innerHTML = `<div class="label">${discLabel}</div>`;
  const discCards = el("div", "discard-cards");
  // Show last few cards (up to last 6)
  const showFrom = Math.max(0, game.discardPile.length - Math.max(6, game.lastDiscardSize));
  game.discardPile.slice(showFrom).forEach((c, idx) => {
    const isInLastSeq = game.lastDiscardWasSequence &&
      idx >= game.discardPile.slice(showFrom).length - game.lastDiscardSize;
    const cEl = makeCardEl(c, { small: false });
    if (yourTurn && game.phase === "playing" && state.selected.size > 0) {
      if (game.lastDiscardWasSequence && isInLastSeq) {
        cEl.style.cursor = "pointer";
        cEl.onclick = () => {
          state.drawChoice = "discard";
          state.drawCardId = c.id;
          render();
        };
        if (state.drawCardId === c.id) cEl.classList.add("selected");
      } else if (!game.lastDiscardWasSequence && idx === game.discardPile.slice(showFrom).length - 1) {
        // top card pickable (single)
        cEl.style.cursor = "pointer";
        cEl.onclick = () => {
          state.drawChoice = "discard";
          state.drawCardId = c.id;
          render();
        };
        if (state.drawCardId === c.id) cEl.classList.add("selected");
      }
    }
    discCards.appendChild(cEl);
  });
  disc.appendChild(discCards);
  piles.appendChild(disc);

  col.appendChild(piles);

  // Your hand
  if (room.youId && game.yourHand && !game.eliminated.includes(room.youId)) {
    const handCard = el("div", "card-ui");
    const sortedHand = game.yourHand.slice().sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
    const total = sortedHand.reduce((s, c) => s + (c.rank <= 10 ? c.rank : 10), 0);
    handCard.innerHTML = `<div class="section-title">Your hand · total ${total} pts</div>`;
    const hand = el("div", "hand");
    for (const c of sortedHand) {
      const cEl = makeCardEl(c);
      if (yourTurn && game.phase === "playing") {
        if (state.selected.has(c.id)) cEl.classList.add("selected");
        cEl.onclick = () => {
          if (state.selected.has(c.id)) state.selected.delete(c.id);
          else state.selected.add(c.id);
          // reset draw choice when selection changes
          state.drawChoice = null;
          state.drawCardId = null;
          render();
        };
      }
      hand.appendChild(cEl);
    }
    handCard.appendChild(hand);
    col.appendChild(handCard);

    // Action bar
    if (yourTurn && game.phase === "playing") {
      const bar = el("div", "action-bar");
      const declareBtn = el("button", "danger");
      declareBtn.textContent = "🎯 Declare";
      declareBtn.disabled = state.selected.size > 0;
      declareBtn.onclick = () => {
        if (!confirm("Declare that you have the lowest hand?")) return;
        socket.emit("game:action", { type: "declare" }, (r) => {
          if (!r.ok) alert(r.error);
        });
      };
      bar.appendChild(declareBtn);

      const playBtn = el("button", "success");
      playBtn.textContent = `Play ${state.selected.size} card${state.selected.size === 1 ? "" : "s"}`;
      const ready = state.selected.size > 0 && state.drawChoice && (state.drawChoice === "deck" || state.drawCardId);
      playBtn.disabled = !ready;
      playBtn.onclick = () => {
        const cardIds = [...state.selected];
        const draw = state.drawChoice === "deck"
          ? { source: "deck" }
          : { source: "discard", cardId: state.drawCardId };
        socket.emit("game:action", { type: "discard", cardIds, draw }, (r) => {
          if (!r.ok) {
            alert(r.error);
            return;
          }
          state.selected.clear();
          state.drawChoice = null;
          state.drawCardId = null;
        });
      };
      bar.appendChild(playBtn);

      if (state.selected.size > 0) {
        const clearBtn = el("button", "ghost");
        clearBtn.textContent = "Clear selection";
        clearBtn.onclick = () => {
          state.selected.clear();
          state.drawChoice = null;
          state.drawCardId = null;
          render();
        };
        bar.appendChild(clearBtn);
      }

      col.appendChild(bar);

      // Hint
      if (state.selected.size > 0 && !state.drawChoice) {
        const hint = el("div", "banner-warn");
        hint.style.marginTop = "8px";
        hint.textContent = "Now choose where to draw a card from: the deck or the discard pile.";
        col.appendChild(hint);
      }
    }
  } else if (game.eliminated.includes(room.youId)) {
    const c = el("div", "banner-warn");
    c.textContent = "You're eliminated. Watching as a spectator.";
    col.appendChild(c);
  }

  return col;
}

function renderRightCol(room, game) {
  const col = el("div", "col");

  // Players & scores
  const sc = el("div", "card-ui");
  sc.innerHTML = `<div class="section-title">Players</div>`;
  sc.appendChild(renderScores(room, game, false));
  col.appendChild(sc);

  // Log
  const logCard = el("div", "card-ui");
  logCard.innerHTML = `<div class="section-title">Game log</div>`;
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
    if (game.mode === "setpoints") {
      right = `${cumScore} / ${game.pointLimit} pts`;
    } else {
      right = isElim ? "OUT" : `${handCount} cards`;
    }
    if (game.lastRoundScores && game.lastRoundScores[p.id] !== undefined) {
      right = `+${game.lastRoundScores[p.id]} → ${cumScore}` + (game.mode === "setpoints" ? ` / ${game.pointLimit}` : "");
    }
    row.innerHTML = `
      <span>
        <span class="dot ${p.connected ? "" : "off"}"></span>
        ${escapeHtml(p.name)}${p.id === room.youId ? " (you)" : ""}
        ${p.isHost ? ' <span class="host-badge">H</span>' : ""}
        ${isElim ? " <small>(out)</small>" : ""}
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
    desc = `Declarer takes +50. ${lowName} scores 0.`;
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
    const w = el("small", "");
    w.textContent = "Waiting for host to start the next round…";
    card.appendChild(w);
  }
  return card;
}

function renderChat() {
  const card = el("div", "card-ui chat");
  card.innerHTML = `<div class="section-title">Chat</div>`;
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

// ============ HELPERS ============

function nameOf(room, pid) {
  const p = room.players.find((x) => x.id === pid);
  return p ? p.name : "?";
}

function makeCardEl(c, opts = {}) {
  const div = document.createElement("div");
  div.className = "card" + (opts.small ? " small" : "");
  if (opts.faceDown || !c) {
    div.classList.add("facedown");
    return div;
  }
  if (RED_SUITS.has(c.suit)) div.classList.add("red");
  const rankMap = { 1: "A", 11: "J", 12: "Q", 13: "K" };
  const r = rankMap[c.rank] || String(c.rank);
  div.innerHTML = `<div class="rank">${r}<br><span style="font-size:.85em">${SUIT_SYMBOLS[c.suit]}</span></div><div class="suit">${SUIT_SYMBOLS[c.suit]}</div>`;
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
