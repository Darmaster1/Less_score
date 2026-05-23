// Less Score — client
const socket = io({ transports: ["websocket", "polling"] });

const SUIT_SYM = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED = new Set(["H", "D"]);
const RANK_LABEL = (r) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[r] ?? String(r));
const CARD_BACKS = [
  { id: "classic-blue", name: "Blue" }, { id: "classic-red", name: "Red" },
  { id: "classic-green", name: "Green" }, { id: "purple", name: "Purple" },
  { id: "dark", name: "Slate" }, { id: "gold", name: "Gold" },
];

// ── State ─────────────────────────────────────────
const S = {
  view: "home",
  code: null, playerId: null, room: null,
  selected: new Set(),
  drawCardId: null,      // which card to draw from pile (null = none chosen yet)
  deckSelected: false,   // true = player clicked deck to draw from it
  modal: null,           // 'rules'|'cardback'|'settings'|'chat'|'scores'|null
  myCardBack: localStorage.getItem("ls_cardback") || "classic-blue",
  chatSeenLen: 0,
  lastLogLen: 0,
  lastTurnPid: null,
  toast: null,
  chatInput: "",         // preserved across re-renders when chat open
};

// ── Session ───────────────────────────────────────
function saveSession() {
  sessionStorage.setItem("ls_code", S.code);
  sessionStorage.setItem("ls_pid", S.playerId);
}
function clearSession() {
  sessionStorage.removeItem("ls_code");
  sessionStorage.removeItem("ls_pid");
}

// ── Heartbeat to server (prevents false AFK detection) ──
setInterval(() => { if (S.code) socket.emit("player:heartbeat"); }, 15000);

// ── Socket events ─────────────────────────────────
socket.on("connect", () => {
  const code = sessionStorage.getItem("ls_code");
  const pid  = sessionStorage.getItem("ls_pid");
  if (code && pid && !S.code) {
    socket.emit("room:join", { code, rejoinPlayerId: pid, cardBack: S.myCardBack }, (res) => {
      if (res?.ok) { S.code = res.code; S.playerId = res.playerId; }
      else clearSession();
      render();
    });
  }
});

socket.on("player:kicked", ({ reason }) => {
  clearSession();
  S.code = null; S.playerId = null; S.room = null; S.view = "home";
  alert("You were removed from the room" + (reason ? ": " + reason : "."));
  render();
});

socket.on("room:state", (room) => {
  S.room = room;
  S.view = room.game ? "game" : "lobby";

  if (room.game) {
    // Clear selection when it's no longer our turn
    if (room.game.currentTurnPlayerId !== room.youId) {
      S.selected.clear(); S.drawCardId = null; S.deckSelected = false;
    }
    // Vibrate on turn start
    if (room.game.phase === "playing" && room.game.currentTurnPlayerId === room.youId && S.lastTurnPid !== room.youId) {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
    S.lastTurnPid = room.game.currentTurnPlayerId;

    // Toast newest log
    const log = room.game.log || [];
    if (log.length > S.lastLogLen && S.lastLogLen > 0) toast(log[log.length - 1].msg);
    if (log.length !== S.lastLogLen) S.lastLogLen = log.length;
  } else {
    S.lastLogLen = 0;
  }

  // Update unread chat count (if chat modal open, mark as read)
  if (S.modal === "chat") S.chatSeenLen = (room.chat || []).length;

  render();
});

// ── Toast ─────────────────────────────────────────
function toast(msg) {
  S.toast = msg; clearTimeout(window._toast);
  window._toast = setTimeout(() => { S.toast = null; render(); }, 4000);
}

// ── Render entry ──────────────────────────────────
function render() {
  const root = document.getElementById("app");
  root.innerHTML = "";
  if (S.view === "home")  root.appendChild(renderHome());
  else if (S.view === "lobby") root.appendChild(renderLobby());
  else if (S.view === "game")  root.appendChild(renderGame());
  if (S.modal) root.appendChild(renderModal());
  if (S.toast) {
    const t = el("div", "toast");
    t.textContent = S.toast;
    root.appendChild(t);
  }
}

// ═══════════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════════
function renderHome() {
  const wrap = el("div", "page-center");
  const box = el("div", "surface home-wrap");

  const logo = el("div", "home-logo");
  logo.innerHTML = `<h1>Less Score</h1><p class="tagline">Real-time card duels — outplay, outscore, declare.</p>`;
  box.appendChild(logo);

  const tabs = el("div", "tabs");
  const tCreate = el("button", "active"); tCreate.textContent = "Create Room";
  const tJoin   = el("button", ""); tJoin.textContent = "Join Room";
  tabs.appendChild(tCreate); tabs.appendChild(tJoin);
  box.appendChild(tabs);

  const fCreate = el("div", "gap-12");
  fCreate.innerHTML = `<label>Your name</label>`;
  const cName = el("input"); cName.placeholder = "e.g. Alex"; cName.maxLength = 20;
  const cBtn = el("button", "btn-primary"); cBtn.textContent = "Create Room";
  fCreate.appendChild(cName); fCreate.appendChild(cBtn);

  const fJoin = el("div", "gap-12"); fJoin.style.display = "none";
  fJoin.innerHTML = `<label>Your name</label>`;
  const jName = el("input"); jName.placeholder = "e.g. Alex"; jName.maxLength = 20;
  const jCode = el("input");
  jCode.placeholder = "Room code"; jCode.maxLength = 5;
  jCode.style.cssText = "text-transform:uppercase;letter-spacing:0.2em;text-align:center;font-family:monospace;font-size:1.1rem;";
  jCode.oninput = () => { jCode.value = jCode.value.toUpperCase(); };
  const jBtn = el("button", "btn-primary"); jBtn.textContent = "Join Room";
  fJoin.appendChild(jName); fJoin.appendChild(jCode); fJoin.appendChild(jBtn);

  box.appendChild(fCreate); box.appendChild(fJoin);
  wrap.appendChild(box);

  const switchTab = (toJoin) => {
    tCreate.className = toJoin ? "" : "active"; tJoin.className = toJoin ? "active" : "";
    fCreate.style.display = toJoin ? "none" : ""; fJoin.style.display = toJoin ? "" : "none";
    if (toJoin) setTimeout(() => jCode.focus(), 50);
  };
  tCreate.onclick = () => switchTab(false);
  tJoin.onclick   = () => switchTab(true);

  // Auto-fill code from URL
  const urlCode = new URLSearchParams(location.search).get("code");
  if (urlCode) { switchTab(true); jCode.value = urlCode.toUpperCase(); }

  cBtn.onclick = () => {
    const name = cName.value.trim() || "Host";
    socket.emit("room:create", { name, cardBack: S.myCardBack }, (res) => {
      if (res?.ok) { S.code = res.code; S.playerId = res.playerId; saveSession(); }
    });
  };
  jBtn.onclick = () => {
    const name = jName.value.trim() || "Player";
    const code = jCode.value.trim().toUpperCase();
    if (!code) return alert("Enter a room code");
    socket.emit("room:join", { code, name, cardBack: S.myCardBack }, (res) => {
      if (res?.ok) { S.code = res.code; S.playerId = res.playerId; saveSession(); }
      else alert(res?.error || "Failed to join");
    });
  };
  return wrap;
}

// ═══════════════════════════════════════════════════
//  LOBBY
// ═══════════════════════════════════════════════════
function renderLobby() {
  const room = state();
  const me = room.players.find(p => p.id === room.youId) || {};
  const isHost = room.youId === room.hostId;
  const allReady = room.players.length >= 2 && room.players.every(p => p.ready);
  const wrap = el("div", "container gap-12");
  wrap.style.paddingTop = "16px";

  // Header
  const hdr = el("div", "surface surface-sm row between");
  hdr.innerHTML = `<div><div style="font-weight:800;font-size:1.1rem;color:#818cf8">Less Score</div><div class="code-display" style="font-size:1.2rem;letter-spacing:.2em;padding:4px 10px;display:inline-block;margin-top:4px">${room.code}</div></div>`;
  const hbtns = el("div", "row"); hbtns.style.gap = "6px";
  [
    ["🎴", me.cardBack ? cbName(me.cardBack) : "Cards", () => openModal("cardback")],
    ["💬", `Chat${unread() ? " (" + unread() + ")" : ""}`, () => openModal("chat")],
    ["? ", "Rules", () => openModal("rules")],
  ].forEach(([icon, label, fn]) => {
    const b = el("button", "btn-ghost btn-sm"); b.textContent = icon + label; b.onclick = fn; hbtns.appendChild(b);
  });
  const leaveBtn = el("button", "btn-danger btn-sm"); leaveBtn.textContent = "Leave";
  leaveBtn.onclick = () => { clearSession(); location.href = location.pathname; };
  hbtns.appendChild(leaveBtn);
  hdr.appendChild(hbtns);
  wrap.appendChild(hdr);

  // Share
  const shareCard = el("div", "surface surface-sm gap-8");
  const inviteUrl = `${location.origin}${location.pathname}?code=${room.code}`;
  const copyBtn = el("button", "btn-ghost btn-sm"); copyBtn.textContent = "Copy invite link";
  copyBtn.onclick = () => copyText(inviteUrl);
  const shareRow = el("div", "row");
  shareRow.appendChild(copyBtn);
  const hint = el("small"); hint.textContent = "Share this link and friends can join from any device.";
  shareCard.appendChild(shareRow); shareCard.appendChild(hint);
  wrap.appendChild(shareCard);

  // Players
  const playersCard = el("div", "surface gap-8");
  const playHdr = el("div", "row between");
  playHdr.innerHTML = `<h3>Players (${room.players.length})</h3>`;
  const readyBtn = el("button", me.ready ? "btn-ghost btn-sm" : "btn-success btn-sm");
  readyBtn.textContent = me.ready ? "Cancel Ready" : "I'm Ready ✓";
  readyBtn.onclick = () => socket.emit("player:setReady", { ready: !me.ready });
  playHdr.appendChild(readyBtn);
  playersCard.appendChild(playHdr);

  const playersList = el("div", "gap-4");
  for (const p of room.players) {
    const row = el("div", "pill" + (p.ready ? " ready" : ""));
    row.innerHTML = `<span class="dot ${p.connected ? "" : "off"}"></span>
      <span style="flex:1">${esc(p.name)}${p.id === room.youId ? " <span style='color:#64748b'>(you)</span>" : ""}</span>
      ${p.isHost ? '<span class="tag tag-host">HOST</span>' : ""}
      ${p.ready ? '<span class="tag tag-ready">READY</span>' : ""}`;
    // Host kick button
    if (isHost && p.id !== room.youId) {
      const kick = el("button", "btn-danger btn-sm"); kick.textContent = "Kick";
      kick.onclick = () => { if (confirm(`Kick ${p.name}?`)) socket.emit("room:kick", { playerId: p.id }); };
      row.appendChild(kick);
    }
    playersList.appendChild(row);
  }
  playersCard.appendChild(playersList);
  wrap.appendChild(playersCard);

  // Settings
  const settCard = el("div", "surface gap-12");
  const settHdr = el("div", "row between");
  settHdr.innerHTML = `<h3>Game Settings</h3>`;
  const custBtn = el("button", "btn-ghost btn-sm"); custBtn.textContent = "Custom Rules";
  custBtn.onclick = () => openModal("settings");
  settHdr.appendChild(custBtn);
  settCard.appendChild(settHdr);

  if (isHost) {
    const modeRow = el("div", "gap-4");
    const modeLabel = el("label"); modeLabel.textContent = "Mode";
    const modeSelect = el("select");
    modeSelect.innerHTML = `<option value="setpoints"${room.settings.mode==="setpoints"?" selected":""}>Set Points — last to reach limit loses</option><option value="elimination"${room.settings.mode==="elimination"?" selected":""}>Elimination — highest each round is out</option>`;

    const limitRow = el("div", "gap-4"); limitRow.style.display = room.settings.mode === "setpoints" ? "" : "none";
    const limitLabel = el("label"); limitLabel.textContent = "Point limit";
    const limitInput = el("input"); limitInput.type = "number"; limitInput.min = "10"; limitInput.value = room.settings.pointLimit;

    const timerLabel = el("label"); timerLabel.textContent = "Turn timer";
    const timerSelect = el("select");
    timerSelect.innerHTML = `<option value="0"${!room.settings.turnTimer?" selected":""}>No timer</option><option value="30"${room.settings.turnTimer===30?" selected":""}>30 seconds</option><option value="60"${room.settings.turnTimer===60?" selected":""}>60 seconds</option>`;

    limitRow.appendChild(limitLabel); limitRow.appendChild(limitInput);
    modeRow.appendChild(modeLabel); modeRow.appendChild(modeSelect);
    settCard.appendChild(modeRow); settCard.appendChild(limitRow);
    settCard.appendChild(timerLabel); settCard.appendChild(timerSelect);

    const sendSettings = () => socket.emit("room:settings", {
      mode: modeSelect.value, pointLimit: Number(limitInput.value || 100),
      turnTimer: Number(timerSelect.value),
    });
    modeSelect.onchange = () => { limitRow.style.display = modeSelect.value === "setpoints" ? "" : "none"; sendSettings(); };
    limitInput.onchange = sendSettings; timerSelect.onchange = sendSettings;

    const startBtn = el("button", "btn-primary");
    startBtn.disabled = !allReady;
    startBtn.textContent = !allReady ? (room.players.length < 2 ? "Need at least 2 players" : "Waiting for everyone to ready up") : "Start Game";
    startBtn.onclick = () => socket.emit("room:start");
    settCard.appendChild(startBtn);
  } else {
    const w = el("div", "hint hint-info"); w.textContent = "Waiting for the host to start the game…";
    settCard.appendChild(w);
  }
  wrap.appendChild(settCard);
  return wrap;
}

// ═══════════════════════════════════════════════════
//  GAME
// ═══════════════════════════════════════════════════
function renderGame() {
  const room = state();
  const game = room.game;
  const wrap = el("div", "game-wrap");

  // Sticky header
  const hdr = el("div", "game-header");
  const titleBlock = el("div", "");
  titleBlock.innerHTML = `<div class="title">Less Score</div><div class="round-info">Round ${game.roundNumber} · ${game.mode === "setpoints" ? `to ${game.pointLimit} pts` : "elimination"}</div>`;
  hdr.appendChild(titleBlock);
  const hbtns = el("div", "hbtns");
  [
    ["💬" + (unread() ? ` (${unread()})` : ""), () => openModal("chat")],
    ["🏆", () => openModal("scores")],
    ["? Rules", () => openModal("rules")],
  ].forEach(([label, fn]) => {
    const b = el("button", "btn-ghost btn-icon"); b.textContent = label; b.onclick = fn; hbtns.appendChild(b);
  });
  hdr.appendChild(hbtns);
  wrap.appendChild(hdr);

  const body = el("div", "container game-wrap");

  if (game.phase === "gameEnd") { body.appendChild(renderGameEnd(room, game)); wrap.appendChild(body); return wrap; }

  // Turn banner
  const yourTurn = game.currentTurnPlayerId === room.youId && !game.isSpectator && game.phase === "playing";
  const currName = pName(room, game.currentTurnPlayerId);
  const banner = el("div", `turn-banner ${yourTurn ? "your-turn" : ""}`);
  let timerHtml = "";
  if (game.turnEndsAt && game.phase === "playing") {
    const secs = Math.max(0, Math.ceil((game.turnEndsAt - Date.now()) / 1000));
    timerHtml = `<span class="turn-timer">⏱ ${secs}s</span>`;
    clearTimeout(window._timerTick); window._timerTick = setTimeout(render, 1000);
  }
  banner.innerHTML = `<span class="turn-who">${yourTurn ? '<span class="you-label">Your turn</span>' : esc(currName) + "'s turn"}</span>${timerHtml}`;
  body.appendChild(banner);

  // Round end result
  if (game.phase === "roundEnd") body.appendChild(renderRoundEnd(room, game));

  // Board
  const board = el("div", "board");
  board.appendChild(renderPlayArea(room, game, yourTurn));
  board.appendChild(renderTurnOrder(room, game));
  body.appendChild(board);

  wrap.appendChild(body);
  return wrap;
}

// ── Play area (left col) ──────────────────────────
function renderPlayArea(room, game, yourTurn) {
  const col = el("div", "gap-10");

  // Show all hands at round end
  if ((game.phase === "roundEnd" || game.phase === "gameEnd") && game.allHands) {
    col.appendChild(renderAllHands(room, game));
  }

  // Piles
  const piles = el("div", "pile-section");

  // ── Draw pile ──
  const drawArea = el("div", "pile-area");
  const drawLabel = el("div", "pile-label"); drawLabel.textContent = `Deck (${game.drawPileCount})`;
  drawArea.appendChild(drawLabel);
  const drawCards = el("div", "pile-cards");
  const deckCard = makeCard(null, {
    faceDown: true, cardBack: myBack(room),
    extra: yourTurn && S.selected.size > 0
      ? (S.deckSelected ? "deck-selected" : "clickable-deck")
      : "",
  });
  if (yourTurn && S.selected.size > 0 && game.phase === "playing") {
    deckCard.onclick = () => { S.deckSelected = !S.deckSelected; if (S.deckSelected) S.drawCardId = null; render(); };
  }
  drawCards.appendChild(deckCard);
  drawArea.appendChild(drawCards);
  piles.appendChild(drawArea);

  // ── Discard pile ──
  const discArea = el("div", "pile-area");
  discArea.style.flex = "1";
  const lastByName = game.lastDiscardBy ? pName(room, game.lastDiscardBy) : null;
  const discLabelEl = el("div", "pile-label");
  discLabelEl.textContent = lastByName ? `Last play — ${lastByName}` : "Centre pile";
  discArea.appendChild(discLabelEl);

  const discCards = el("div", "pile-cards");
  const visible = game.visibleDiscard || [];
  const canPickFromPile = yourTurn && game.phase === "playing" && S.selected.size > 0
    && (game.lastDiscardBy === null || game.lastDiscardBy !== room.youId);

  visible.forEach((c) => {
    let extra = "";
    if (canPickFromPile) {
      extra = S.drawCardId === c.id ? "pick-selected" : "pickable";
    }
    const cEl = makeCard(c, { extra });
    if (canPickFromPile) {
      cEl.onclick = () => {
        S.drawCardId = (S.drawCardId === c.id) ? null : c.id;
        if (S.drawCardId) S.deckSelected = false;
        render();
      };
    }
    discCards.appendChild(cEl);
  });
  discArea.appendChild(discCards);

  if (canPickFromPile && visible.length > 1 && game.lastDiscardBy) {
    const hint = el("div", "hint hint-info mt-4");
    hint.style.fontSize = "0.8rem";
    hint.textContent = "Tap a card to pick it up from the last play.";
    discArea.appendChild(hint);
  }
  piles.appendChild(discArea);
  col.appendChild(piles);

  // ── Your hand ──
  if (!game.isSpectator && room.youId && game.yourHand && !game.eliminated.includes(room.youId)) {
    const handCard = el("div", "surface");
    const handHdr = el("div", "row between");
    handHdr.innerHTML = `<h3>Your hand</h3><span style="font-weight:800;color:#fbbf24">${handTotal(game.yourHand)} pts</span>`;
    handCard.appendChild(handHdr);

    const hand = el("div", "hand");
    const sorted = [...game.yourHand].sort((a, b) => a.rank - b.rank);
    sorted.forEach(c => {
      const isSelected = S.selected.has(c.id);
      const cEl = makeCard(c, { extra: isSelected ? "selected" : "" });
      if (yourTurn && game.phase === "playing") {
        cEl.onclick = () => {
          if (S.selected.has(c.id)) S.selected.delete(c.id);
          else S.selected.add(c.id);
          S.drawCardId = null; S.deckSelected = false;
          render();
        };
      }
      hand.appendChild(cEl);
    });
    handCard.appendChild(hand);
    col.appendChild(handCard);

    // ── Action bar ──
    if (yourTurn && game.phase === "playing") {
      const bar = el("div", "action-bar");

      const declBtn = el("button", "btn-danger"); declBtn.textContent = "🎯 Declare";
      declBtn.disabled = S.selected.size > 0;
      declBtn.onclick = () => {
        if (!confirm("Declare that you have the lowest hand?")) return;
        socket.emit("game:action", { type: "declare" }, r => { if (!r.ok) alert(r.error); });
      };
      bar.appendChild(declBtn);

      const drawReady = S.deckSelected || !!S.drawCardId;
      const playReady = S.selected.size > 0 && drawReady;
      const playBtn = el("button", "btn-success"); 
      playBtn.textContent = S.selected.size ? `Play ${S.selected.size} card${S.selected.size > 1 ? "s" : ""}` : "Select cards";
      playBtn.disabled = !playReady;
      playBtn.onclick = () => {
        const cardIds = [...S.selected];
        const draw = S.deckSelected ? { source: "deck" } : { source: "discard", cardId: S.drawCardId };
        socket.emit("game:action", { type: "discard", cardIds, draw }, r => {
          if (!r.ok) { alert(r.error); return; }
          S.selected.clear(); S.drawCardId = null; S.deckSelected = false;
        });
      };
      bar.appendChild(playBtn);

      if (S.selected.size > 0) {
        const clrBtn = el("button", "btn-ghost");
        clrBtn.textContent = "Clear"; 
        clrBtn.onclick = () => { S.selected.clear(); S.drawCardId = null; S.deckSelected = false; render(); };
        bar.appendChild(clrBtn);
      }

      col.appendChild(bar);

      if (S.selected.size > 0 && !drawReady) {
        const hint = el("div", "hint hint-warn");
        hint.style.margin = "0 14px";
        hint.textContent = game.lastDiscardBy && game.lastDiscardBy !== room.youId
          ? "Now tap the deck or a card from the last play to complete your turn."
          : "Now tap the deck to draw.";
        col.appendChild(hint);
      }
    }

  } else if (game.phase === "playing" && game.isSpectator && game.allHands) {
    col.appendChild(renderAllHands(room, game));
  } else if (game.eliminated.includes(room.youId) && game.phase === "playing") {
    const w = el("div", "hint hint-info");
    w.textContent = `You're eliminated — spectating${game.showHandsToSpectators ? " with all hands visible" : ""}.`;
    col.appendChild(w);
  }

  return col;
}

// ── Turn order (right col) ───────────────────────
function renderTurnOrder(room, game) {
  const col = el("div", "gap-10");
  const card = el("div", "surface gap-8");
  card.innerHTML = `<h3>Turn order</h3>`;

  const list = el("div", "turn-order");
  const ids = game.playerIds || room.players.map(p => p.id);
  // Rotate so current player is first in display
  const curIdx = ids.indexOf(game.currentTurnPlayerId);

  ids.forEach((pid, rawIdx) => {
    const isElim = game.eliminated.includes(pid);
    const isCurrent = pid === game.currentTurnPlayerId && game.phase === "playing";
    const row = el("div", `turn-row ${isCurrent ? "active" : ""} ${isElim ? "out" : ""}`);

    const indicator = el("div", "turn-indicator");
    const nameSpan = el("div", "turn-name");
    const p = room.players.find(x => x.id === pid);
    const nameText = p ? p.name : "?";
    const isYou = pid === room.youId;
    nameSpan.innerHTML = esc(nameText) + (isYou ? ` <span style="color:#64748b;font-size:.8em">(you)</span>` : "");

    // Score
    const score = el("div", "turn-score");
    if (game.mode === "setpoints") {
      score.textContent = `${game.cumulativeScores[pid] ?? 0}`;
    } else {
      score.textContent = isElim ? "OUT" : `${game.handCounts?.[pid] ?? 0} cards`;
    }

    row.appendChild(indicator); row.appendChild(nameSpan); row.appendChild(score);

    // Played cards this round (mini cards)
    const played = game.lastPlayedThisRound?.[pid];
    if (played && played.cards && played.cards.length) {
      const playedDiv = el("div", "turn-played");
      played.cards.slice(0, 5).forEach(c => {
        const mc = el("span", `mini-card ${RED.has(c.suit) ? "red" : ""}`);
        mc.textContent = RANK_LABEL(c.rank) + SUIT_SYM[c.suit];
        playedDiv.appendChild(mc);
      });
      if (played.cards.length > 5) {
        const mc = el("span", "mini-card"); mc.textContent = `+${played.cards.length - 5}`;
        playedDiv.appendChild(mc);
      }
      row.appendChild(playedDiv);
    } else if (game.phase === "playing" && !isElim) {
      const waitDiv = el("div", "turn-score");
      waitDiv.style.color = "#334155";
      waitDiv.textContent = isCurrent ? "▶" : "·";
      row.appendChild(waitDiv);
    }

    list.appendChild(row);
  });

  card.appendChild(list);
  col.appendChild(card);

  // Host controls in-game
  if (room.youId === room.hostId && game.phase === "playing") {
    const hostCard = el("div", "surface surface-sm gap-8");
    hostCard.innerHTML = `<h3>Host Controls</h3>`;
    const kickableList = room.players.filter(p => p.id !== room.youId && !game.eliminated.includes(p.id));
    if (kickableList.length) {
      for (const p of kickableList) {
        const row = el("div", "row between");
        row.innerHTML = `<span><span class="dot ${p.connected ? "" : "off"}"></span> ${esc(p.name)}</span>`;
        const kb = el("button", "btn-danger btn-sm"); kb.textContent = "Kick";
        kb.onclick = () => { if (confirm(`Kick ${p.name} from the game?`)) socket.emit("room:kick", { playerId: p.id }); };
        row.appendChild(kb);
        hostCard.appendChild(row);
      }
    } else {
      const w = el("small"); w.textContent = "No other players to kick."; hostCard.appendChild(w);
    }
    col.appendChild(hostCard);
  }

  return col;
}

// ── All hands reveal ─────────────────────────────
function renderAllHands(room, game) {
  const wrap = el("div", "surface gap-8");
  wrap.innerHTML = `<h3>${game.phase === "roundEnd" ? "Hands this round" : "Final hands"}</h3>`;
  const all = el("div", "all-hands");
  for (const [pid, h] of Object.entries(game.allHands || {})) {
    const div = el("div", "hand-reveal");
    const hdr = el("div", "hand-reveal-header");
    const p = room.players.find(x => x.id === pid);
    hdr.innerHTML = `<div class="hand-reveal-name">${esc(p?.name ?? "?")}${pid === game.declarerId ? ' <span class="tag tag-decl">DECLARED</span>' : ""}</div><div class="hand-total">${handTotal(h)} pts</div>`;
    div.appendChild(hdr);
    const handDiv = el("div", "hand");
    [...h].sort((a, b) => a.rank - b.rank).forEach(c => handDiv.appendChild(makeCard(c)));
    div.appendChild(handDiv);
    all.appendChild(div);
  }
  wrap.appendChild(all);
  return wrap;
}

// ── Round end ─────────────────────────────────────
function renderRoundEnd(room, game) {
  const d = game.roundEndDetail || {};
  const decName = pName(room, game.declarerId);
  let msg = "";
  if (d.case === "declarerLowest") msg = `${decName} declared and had the lowest hand! Scores 0.`;
  else if (d.case === "tie") msg = `${decName} declared — tied for lowest. Scores 0.`;
  else if (d.case === "penalty") {
    const lowNames = (d.lowestPids || []).map(id => pName(room, id)).join(", ");
    msg = `${decName} declared but ${lowNames || "someone"} had less! +${d.penalty || 50} penalty.`;
  }
  const wrap = el("div", "surface gap-12");
  wrap.innerHTML = `<div class="result-banner"><h2>${esc(msg)}</h2></div>`;

  if (d.newlyEliminated?.length) {
    const e = el("div", "hint hint-warn");
    e.textContent = `Eliminated: ${d.newlyEliminated.map(id => pName(room, id)).join(", ")}`;
    wrap.appendChild(e);
  }

  if (room.youId === room.hostId) {
    const btn = el("button", "btn-success"); btn.textContent = "Start Next Round";
    btn.onclick = () => socket.emit("game:nextRound");
    wrap.appendChild(btn);
  } else {
    const w = el("small"); w.textContent = "Waiting for the host to start the next round…"; wrap.appendChild(w);
  }
  return wrap;
}

// ── Game end ──────────────────────────────────────
function renderGameEnd(room, game) {
  const winner = room.players.find(p => p.id === game.winnerId);
  const wrap = el("div", "gap-12");

  const banner = el("div", "surface result-banner");
  banner.innerHTML = `<h1>Game Over 🏆</h1><h2>${winner ? esc(winner.name) + " wins!" : "No winner"}</h2>`;
  wrap.appendChild(banner);

  if (game.allHands) wrap.appendChild(renderAllHands(room, game));

  const statsCard = el("div", "surface gap-8");
  statsCard.innerHTML = `<h3>Match Statistics</h3>`;
  const grid = el("div", "stat-grid");
  for (const s of buildStats(room, game)) {
    const c = el("div", "stat-card");
    c.innerHTML = `<div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div>${s.detail ? `<div class="stat-detail">${esc(s.detail)}</div>` : ""}`;
    grid.appendChild(c);
  }
  statsCard.appendChild(grid);
  wrap.appendChild(statsCard);

  if (room.youId === room.hostId) {
    const btn = el("button", "btn-ghost"); btn.textContent = "Return to Lobby";
    btn.onclick = () => socket.emit("game:resetLobby");
    wrap.appendChild(btn);
  }
  return wrap;
}

function buildStats(room, game) {
  const all = room.players; const st = game.stats || {}; const out = [];
  const n = pid => pid ? pName(room, pid) : "—";
  const best = (key, cmp, display) => {
    let winner = null, val = cmp === "min" ? Infinity : -1;
    for (const p of all) {
      const v = st[p.id]?.[key] ?? (cmp === "min" ? Infinity : 0);
      if (cmp === "min" ? v < val : v > val) { winner = p.id; val = v; }
    }
    return { winner, val };
  };
  const {winner:la, val:lav} = best("totalRoundScore", "min");
  const avg = la ? ((st[la]?.totalRoundScore ?? 0) / Math.max(1, st[la]?.roundsPlayed ?? 1)).toFixed(1) : "—";
  out.push({ label: "Lowest Average Score", value: n(la), detail: `${avg} pts/round` });
  const {winner:dw, val:dwv} = best("declarationsWon", "max");
  out.push({ label: "Most Declarations Won", value: n(dw), detail: `${dwv} wins` });
  const {winner:df, val:dfv} = best("declarationsFailed", "max");
  out.push({ label: "Most Risky Declarer", value: n(df), detail: `${dfv} failed` });
  const {winner:bh, val:bhv} = best("bestHandTotal", "min");
  out.push({ label: "Lowest Hand Achieved", value: n(bh), detail: bhv !== Infinity ? `${bhv} pts` : "" });
  const {winner:sq, val:sqv} = best("sequencesPlayed", "max");
  out.push({ label: "Most Sequences Played", value: n(sq), detail: `${sqv} sequences` });
  const {winner:qu, val:quv} = best("quadsPlayed", "max");
  out.push({ label: "Most Quads Played", value: n(qu), detail: `${quv} quads` });
  const {winner:cd, val:cdv} = best("cardsDiscarded", "max");
  out.push({ label: "Most Cards Discarded", value: n(cd), detail: `${cdv} cards` });
  const {winner:lo, val:lov} = best("timesLowest", "max");
  out.push({ label: "Most Often Lowest", value: n(lo), detail: `${lov} rounds` });
  return out;
}

// ═══════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════
function openModal(id) {
  S.modal = id;
  if (id === "chat" && S.room?.chat) S.chatSeenLen = S.room.chat.length;
  render();
}

function renderModal() {
  const bg = el("div", "modal-bg");
  bg.onclick = e => { if (e.target === bg) closeModal(); };
  const modal = el("div", "modal");

  const hdr = el("div", "modal-header");
  const title = el("h2");
  const closeBtn = el("button", "btn-ghost btn-sm"); closeBtn.textContent = "✕";
  closeBtn.onclick = closeModal;
  hdr.appendChild(title); hdr.appendChild(closeBtn);
  modal.appendChild(hdr);

  const body = el("div", "");
  if (S.modal === "chat") { title.textContent = "💬 Chat"; body.appendChild(renderChatBody()); }
  else if (S.modal === "rules") { title.textContent = "? How to Play"; body.appendChild(renderRulesBody()); }
  else if (S.modal === "cardback") { title.textContent = "🎴 Card Back"; body.appendChild(renderCardBackBody()); }
  else if (S.modal === "settings") { title.textContent = "⚙ Custom Rules"; body.appendChild(renderSettingsBody()); }
  else if (S.modal === "scores") { title.textContent = "🏆 Leaderboard"; body.appendChild(renderScoresBody()); }
  modal.appendChild(body);
  bg.appendChild(modal);
  return bg;
}

function closeModal() { S.modal = null; render(); }

// ── Chat ──────────────────────────────────────────
function renderChatBody() {
  const wrap = el("div", "");
  const scroll = el("div", "chat-scroll");
  for (const m of (S.room?.chat ?? [])) {
    const row = el("div", "chat-msg");
    row.innerHTML = `<span class="chat-from">${esc(m.from)}</span>: ${esc(m.text)}`;
    scroll.appendChild(row);
  }
  wrap.appendChild(scroll);
  setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 0);

  const form = el("form", "chat-form");
  form.innerHTML = `<input id="chat-in" placeholder="Type a message…" maxlength="200" autocomplete="off" value="${esc(S.chatInput)}" /><button class="btn-primary">Send</button>`;
  form.onsubmit = e => {
    e.preventDefault();
    const inp = form.querySelector("#chat-in");
    const text = inp.value.trim();
    if (!text) return;
    socket.emit("chat:send", { text });
    inp.value = ""; S.chatInput = "";
    if (S.room?.chat) S.chatSeenLen = S.room.chat.length + 1;
  };
  form.querySelector("#chat-in").oninput = e => { S.chatInput = e.target.value; };
  wrap.appendChild(form);
  setTimeout(() => { const inp = document.getElementById("chat-in"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 50);
  return wrap;
}

// ── Leaderboard modal ─────────────────────────────
function renderScoresBody() {
  const room = state(); const game = room.game; if (!game) return el("div", "");
  const wrap = el("div", "score-list mt-8");
  const sorted = [...room.players].sort((a, b) => {
    const ea = game.eliminated.includes(a.id) ? 1 : 0;
    const eb = game.eliminated.includes(b.id) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return (game.cumulativeScores[a.id] ?? 0) - (game.cumulativeScores[b.id] ?? 0);
  });
  const medals = ["🥇","🥈","🥉"];
  sorted.forEach((p, i) => {
    const elim = game.eliminated.includes(p.id);
    const row = el("div", `score-item ${elim ? "out" : ""}`);
    const left = el("div", "score-left");
    left.innerHTML = `<span class="medal">${medals[i] || ""}</span><span class="dot ${p.connected?"":"off"}"></span><span>${esc(p.name)}${p.id===room.youId?" (you)":""}</span>${elim?'<span class="tag tag-out">OUT</span>':""}`;
    const pts = el("div", "score-pts");
    pts.textContent = game.mode === "setpoints"
      ? `${game.cumulativeScores[p.id]??0} / ${game.pointLimit}`
      : (elim ? "OUT" : `${game.handCounts?.[p.id]??0} cards`);
    if (game.lastRoundScores?.[p.id] !== undefined)
      pts.textContent = `+${game.lastRoundScores[p.id]} → ${game.cumulativeScores[p.id]??0}`;
    row.appendChild(left); row.appendChild(pts);
    wrap.appendChild(row);
  });
  return wrap;
}

// ── Rules ─────────────────────────────────────────
function renderRulesBody() {
  const wrap = el("div", "gap-12");
  wrap.innerHTML = `
    <p>Each player holds a hand of cards. Goal: have the <b>lowest hand total</b> when someone declares. Aces = 1 pt, face cards = 10 pts, others face value.</p>
    <h3>Each Turn</h3>
    <p>Either <b>Declare</b> (end the round) or <b>Discard</b> a valid set then draw one card.</p>
    <h3>Valid Sets</h3>
  `;
  const exWrap = el("div", "gap-8");
  [
    ["Single card", [{ r: 7, s: "H" }]],
    ["Pair (same rank)", [{ r: 9, s: "S" }, { r: 9, s: "D" }]],
    ["Four-of-a-kind", [{ r: 5, s: "S" }, { r: 5, s: "H" }, { r: 5, s: "D" }, { r: 5, s: "C" }]],
    ["3-card sequence (any suits)", [{ r: 4, s: "S" }, { r: 5, s: "H" }, { r: 6, s: "D" }]],
    ["Q–K–A (Ace always high in sequences)", [{ r: 12, s: "S" }, { r: 13, s: "H" }, { r: 1, s: "D" }]],
    ["5-card sequence (10–J–Q–K–A)", [{ r: 10, s: "S" }, { r: 11, s: "H" }, { r: 12, s: "D" }, { r: 13, s: "C" }, { r: 1, s: "S" }]],
  ].forEach(([label, cards]) => {
    const g = el("div", "gap-4");
    const l = el("b"); l.textContent = label;
    const ex = el("div", "example-row");
    cards.forEach(({ r, s }) => ex.appendChild(makeCard({ id: "ex" + r + s, rank: r, suit: s })));
    g.appendChild(l); g.appendChild(ex);
    exWrap.appendChild(g);
  });
  wrap.appendChild(exWrap);
  wrap.innerHTML += `
    <h3>Pickup Rule</h3>
    <p>You can pick <b>any card</b> from the previous player's discarded set (not just the top card), including pairs, sequences, and quads. Tap the card you want.</p>
    <h3>Declaration</h3>
    <p><b>You're lowest</b> → you score 0, others score their hand totals.<br><b>Tie</b> → you score 0.<br><b>Someone is lower</b> → you take the penalty (default +50), that player scores 0.</p>
    <h3>Modes</h3>
    <p><b>Set Points</b>: cumulative across rounds. Hit the limit and you're eliminated.<br><b>Elimination</b>: highest-scoring player is out each round.</p>
  `;
  return wrap;
}

// ── Card back picker ──────────────────────────────
function renderCardBackBody() {
  const me = S.room?.players.find(p => p.id === S.room.youId) || {};
  const wrap = el("div", "gap-12");
  const grid = el("div", "cb-grid");
  CARD_BACKS.forEach(cb => {
    const opt = el("div", `cb-option ${me.cardBack === cb.id ? "selected" : ""}`);
    opt.appendChild(makeCard(null, { faceDown: true, cardBack: cb.id }));
    const n = el("div", "cb-name"); n.textContent = cb.name;
    opt.appendChild(n);
    opt.onclick = () => {
      S.myCardBack = cb.id;
      localStorage.setItem("ls_cardback", cb.id);
      socket.emit("player:setCardBack", { cardBack: cb.id });
    };
    grid.appendChild(opt);
  });
  wrap.appendChild(grid);
  return wrap;
}

// ── Settings ──────────────────────────────────────
function renderSettingsBody() {
  const room = state();
  const isHost = room.youId === room.hostId && !room.started;
  const r = room.settings.rules;
  const wrap = el("div", "gap-12");

  if (!isHost) {
    const note = el("div", "hint hint-info"); note.textContent = "Only the host can change rules before the game starts.";
    wrap.appendChild(note);
  }

  const nums = el("div", "gap-8");
  nums.innerHTML = `
    <div class="toggle-row">
      <div class="toggle-info"><b>Starting hand size</b><small>Cards dealt per player (3–10)</small></div>
      <input type="number" id="s-hand" min="3" max="10" value="${r.startingHandSize}" style="width:70px" ${isHost?"":"disabled"} />
    </div>
    <div class="toggle-row">
      <div class="toggle-info"><b>Declaration penalty</b><small>Points for a failed declaration</small></div>
      <input type="number" id="s-pen" min="0" max="500" value="${r.declarationPenalty}" style="width:70px" ${isHost?"":"disabled"} />
    </div>
  `;
  wrap.appendChild(nums);

  [
    ["allowTriplets", "Allow triplets", "Discard three cards of the same rank"],
    ["allow4Seq", "Allow 4-card sequences", "e.g. 5-6-7-8 across any suits"],
    ["allow6PlusSeq", "Allow 6+ card sequences", "Long sequences of 6 or more cards"],
    ["allowWrapAround", "Wrap-around (K–A–2)", "Sequences can span from King through Ace to low cards"],
  ].forEach(([key, label, desc]) => {
    wrap.appendChild(buildToggle(label, desc, r[key], isHost, () => socket.emit("room:settings", { rules: { [key]: !r[key] } })));
  });
  wrap.appendChild(buildToggle(
    "Spectators see all hands", "Eliminated players can view everyone's cards",
    !!room.settings.showHandsToSpectators, isHost,
    () => socket.emit("room:settings", { showHandsToSpectators: !room.settings.showHandsToSpectators })
  ));

  if (isHost) {
    const send = () => socket.emit("room:settings", { rules: {
      startingHandSize: Number(nums.querySelector("#s-hand").value || 5),
      declarationPenalty: Number(nums.querySelector("#s-pen").value || 50),
    }});
    nums.querySelector("#s-hand").onchange = send;
    nums.querySelector("#s-pen").onchange = send;
  }
  return wrap;
}

function buildToggle(label, desc, value, enabled, fn) {
  const row = el("div", "toggle-row");
  row.innerHTML = `<div class="toggle-info"><b>${esc(label)}</b><small>${esc(desc)}</small></div>`;
  const tog = el("div", `toggle ${value ? "on" : ""} ${enabled ? "" : "disabled"}`);
  if (enabled) tog.onclick = fn;
  row.appendChild(tog);
  return row;
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function state() { return S.room; }
function pName(room, pid) { return room.players.find(x => x.id === pid)?.name ?? "?"; }
function myBack(room) { return room.players.find(p => p.id === room.youId)?.cardBack ?? "classic-blue"; }
function cbName(id) { return CARD_BACKS.find(c => c.id === id)?.name ?? "Blue"; }
function unread() { return Math.max(0, (S.room?.chat?.length ?? 0) - S.chatSeenLen); }
function handTotal(hand) { return (hand || []).reduce((s, c) => s + (c.rank <= 10 ? c.rank : 10), 0); }

function makeCard(c, { faceDown = false, cardBack = "classic-blue", extra = "" } = {}) {
  const div = el("div", `card ${extra}`);
  if (!c || faceDown) {
    div.classList.add(cardBack);
    return div;
  }
  if (RED.has(c.suit)) div.classList.add("red");
  div.innerHTML = `<div class="rank">${RANK_LABEL(c.rank)}</div><div class="suit-big">${SUIT_SYM[c.suit]}</div>`;
  return div;
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls; return e;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => alert("Copied!")).catch(() => prompt("Copy:", t));
}

render();
