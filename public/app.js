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
  drawCardId: null,      // card id chosen from discard pile
  deckSelected: false,   // player tapped deck card
  modal: null,           // 'rules'|'cardback'|'settings'|'chat'|'scores'|null
  myCardBack: localStorage.getItem("ls_cardback") || "classic-blue",
  chatSeenLen: 0,
  lastLogLen: 0,
  lastTurnPid: null,
  toast: null,
  chatInput: "",
  expandedPid: null,     // which player row is expanded (host controls)
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

// ── Heartbeat ─────────────────────────────────────
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
    if (room.game.currentTurnPlayerId !== room.youId) {
      S.selected.clear(); S.drawCardId = null; S.deckSelected = false;
    }
    if (room.game.phase === "playing" && room.game.currentTurnPlayerId === room.youId
        && S.lastTurnPid !== room.youId) {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
    S.lastTurnPid = room.game.currentTurnPlayerId;
    const log = room.game.log || [];
    if (log.length > S.lastLogLen && S.lastLogLen > 0) showToast(log[log.length - 1].msg);
    if (log.length !== S.lastLogLen) S.lastLogLen = log.length;
  } else {
    S.lastLogLen = 0;
  }
  if (S.modal === "chat") S.chatSeenLen = (room.chat || []).length;
  render();
});

// ── Toast ─────────────────────────────────────────
function showToast(msg) {
  S.toast = msg; clearTimeout(window._toast);
  window._toast = setTimeout(() => { S.toast = null; render(); }, 4000);
}

// ── Render ────────────────────────────────────────
function render() {
  const root = document.getElementById("app");
  root.innerHTML = "";
  if      (S.view === "home")  root.appendChild(renderHome());
  else if (S.view === "lobby") root.appendChild(renderLobby());
  else if (S.view === "game")  root.appendChild(renderGame());
  if (S.modal) root.appendChild(renderModal());
  if (S.toast) {
    const t = el("div", "toast"); t.textContent = S.toast; root.appendChild(t);
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
  const tJoin   = el("button", "");       tJoin.textContent   = "Join Room";
  tabs.appendChild(tCreate); tabs.appendChild(tJoin);
  box.appendChild(tabs);

  const fCreate = el("div", "gap-12");
  const cNameLabel = el("label"); cNameLabel.textContent = "Your name";
  const cName = el("input"); cName.placeholder = "e.g. Alex"; cName.maxLength = 20;
  const cBtn = el("button", "btn-primary"); cBtn.textContent = "Create Room";
  fCreate.appendChild(cNameLabel); fCreate.appendChild(cName); fCreate.appendChild(cBtn);

  const fJoin = el("div", "gap-12"); fJoin.style.display = "none";
  const jNameLabel = el("label"); jNameLabel.textContent = "Your name";
  const jName = el("input"); jName.placeholder = "e.g. Alex"; jName.maxLength = 20;
  const jCodeLabel = el("label"); jCodeLabel.textContent = "Room code";
  const jCode = el("input");
  jCode.placeholder = "ABCDE"; jCode.maxLength = 5;
  jCode.style.cssText = "text-transform:uppercase;letter-spacing:.22em;text-align:center;font-family:ui-monospace,monospace;font-size:1.2rem;";
  jCode.oninput = () => { jCode.value = jCode.value.toUpperCase(); };
  const jBtn = el("button", "btn-primary"); jBtn.textContent = "Join Room";
  fJoin.appendChild(jNameLabel); fJoin.appendChild(jName);
  fJoin.appendChild(jCodeLabel); fJoin.appendChild(jCode); fJoin.appendChild(jBtn);

  box.appendChild(fCreate); box.appendChild(fJoin);
  wrap.appendChild(box);

  const switchTab = (toJoin) => {
    tCreate.className = toJoin ? "" : "active"; tJoin.className = toJoin ? "active" : "";
    fCreate.style.display = toJoin ? "none" : ""; fJoin.style.display = toJoin ? "" : "none";
    if (toJoin) setTimeout(() => jCode.focus(), 50);
  };
  tCreate.onclick = () => switchTab(false);
  tJoin.onclick   = () => switchTab(true);

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

  // ── Header bar (title + code + share + nav) ──
  const hdr = el("div", "surface surface-sm lobby-header");
  const titleLine = el("div", "lobby-title-line");
  const titleEl = el("div", "lobby-title"); titleEl.textContent = "Less Score";
  const codeEl = el("div", "lobby-code"); codeEl.textContent = room.code;
  const shareBtn = el("button", "btn-ghost btn-sm");
  shareBtn.textContent = "📋 Share";
  shareBtn.onclick = () => {
    const url = `${location.origin}${location.pathname}?code=${room.code}`;
    copyText(url);
  };
  titleLine.appendChild(titleEl); titleLine.appendChild(codeEl); titleLine.appendChild(shareBtn);
  hdr.appendChild(titleLine);

  const navBtns = el("div", "row"); navBtns.style.gap = "6px"; navBtns.style.flexWrap = "wrap";
  const unreadCount = unread();
  [
    ["🎴 Cards",  () => openModal("cardback")],
    [unreadCount ? `💬 (${unreadCount})` : "💬 Chat", () => openModal("chat")],
    ["⚙ Settings", () => openModal("settings")],
    ["? Rules",    () => openModal("rules")],
  ].forEach(([label, fn]) => {
    const b = el("button", "btn-ghost btn-sm"); b.textContent = label; b.onclick = fn;
    navBtns.appendChild(b);
  });
  const leaveBtn = el("button", "btn-danger btn-sm"); leaveBtn.textContent = "Leave";
  leaveBtn.onclick = () => { clearSession(); location.href = location.pathname; };
  navBtns.appendChild(leaveBtn);
  hdr.appendChild(navBtns);
  wrap.appendChild(hdr);

  // ── Players ──
  const playersCard = el("div", "surface gap-10");
  const playHdr = el("div", "row between");
  const playTitle = el("div", "section-title"); playTitle.textContent = `Players (${room.players.length})`;
  playHdr.appendChild(playTitle);
  const readyBtn = el("button", me.ready ? "btn-ghost btn-sm" : "btn-success btn-sm");
  readyBtn.textContent = me.ready ? "Cancel Ready" : "Ready ✓";
  readyBtn.onclick = () => socket.emit("player:setReady", { ready: !me.ready });
  playHdr.appendChild(readyBtn);
  playersCard.appendChild(playHdr);

  const playersList = el("div", "gap-6");
  for (const p of room.players) {
    const row = el("div", `player-row ${p.ready ? "ready" : ""}`);
    const left = el("div", "row"); left.style.flex = "1"; left.style.gap = "8px";
    const dot = el("span", `dot ${p.connected ? "" : "off"}`);
    const nameSpan = el("span", "player-name");
    nameSpan.innerHTML = esc(p.name) + (p.id === room.youId ? ` <span class="you-label">(you)</span>` : "");
    left.appendChild(dot); left.appendChild(nameSpan);
    if (p.isHost) { const t = el("span", "tag tag-host"); t.textContent = "Host"; left.appendChild(t); }
    if (p.ready)  { const t = el("span", "tag tag-ready"); t.textContent = "Ready"; left.appendChild(t); }
    row.appendChild(left);
    if (isHost && p.id !== room.youId) {
      const kick = el("button", "btn-danger btn-sm"); kick.textContent = "Kick";
      kick.onclick = () => { if (confirm(`Kick ${p.name}?`)) socket.emit("room:kick", { playerId: p.id }); };
      row.appendChild(kick);
    }
    playersList.appendChild(row);
  }
  playersCard.appendChild(playersList);
  wrap.appendChild(playersCard);

  // ── Start button (host only) ──
  if (isHost) {
    const startBtn = el("button", "btn-primary");
    startBtn.style.width = "100%";
    startBtn.disabled = !allReady;
    startBtn.textContent = !allReady
      ? (room.players.length < 2 ? "Need at least 2 players" : "Waiting for everyone to ready up")
      : "Start Game";
    startBtn.onclick = () => socket.emit("room:start");
    wrap.appendChild(startBtn);
  } else {
    const w = el("div", "hint hint-info"); w.textContent = "Waiting for the host to start the game…";
    wrap.appendChild(w);
  }

  return wrap;
}

// ═══════════════════════════════════════════════════
//  GAME
// ═══════════════════════════════════════════════════
function renderGame() {
  const room = state();
  const game = room.game;
  const wrap = el("div", "game-wrap");

  // ── Sticky header ──
  const hdr = el("div", "game-header");
  const titleBlock = el("div", "");
  titleBlock.innerHTML = `<div class="game-title">Less Score</div><div class="game-subtitle">Round ${game.roundNumber} · ${game.mode === "setpoints" ? `first to ${game.pointLimit} pts` : "elimination"}</div>`;
  hdr.appendChild(titleBlock);
  const hbtns = el("div", "hbtns");
  const unreadCount = unread();
  [
    [unreadCount ? `💬 (${unreadCount})` : "💬", () => openModal("chat")],
    ["🏆", () => openModal("scores")],
    ["? Rules", () => openModal("rules")],
  ].forEach(([label, fn]) => {
    const b = el("button", "btn-ghost btn-icon"); b.textContent = label; b.onclick = fn;
    hbtns.appendChild(b);
  });
  hdr.appendChild(hbtns);
  wrap.appendChild(hdr);

  const body = el("div", "container game-wrap");

  if (game.phase === "gameEnd") {
    body.appendChild(renderGameEnd(room, game));
    wrap.appendChild(body);
    return wrap;
  }

  // ── Board ──
  const board = el("div", "board");
  board.appendChild(renderPlayArea(room, game));
  board.appendChild(renderRightCol(room, game));
  body.appendChild(board);
  wrap.appendChild(body);
  return wrap;
}

// ── Play area (left col) ──────────────────────────
function renderPlayArea(room, game) {
  const yourTurn = game.currentTurnPlayerId === room.youId && !game.isSpectator && game.phase === "playing";
  const col = el("div", "gap-10");

  if ((game.phase === "roundEnd" || game.phase === "gameEnd") && game.allHands) {
    col.appendChild(renderRoundEnd(room, game));
    col.appendChild(renderAllHands(room, game));
    return col;
  }

  // ── Piles ──
  const piles = el("div", "pile-section");

  // Draw pile (deck)
  const drawArea = el("div", "pile-area");
  const drawLabel = el("div", "pile-label"); drawLabel.textContent = `Deck · ${game.drawPileCount} cards`;
  drawArea.appendChild(drawLabel);
  const drawCards = el("div", "pile-cards");
  const canClickDeck = yourTurn && game.phase === "playing";
  const deckCard = makeCard(null, {
    faceDown: true, cardBack: myBack(room),
    extra: canClickDeck ? (S.deckSelected ? "deck-selected" : "clickable-deck") : "facedown",
  });
  if (canClickDeck) {
    deckCard.title = "Tap to draw from deck";
    deckCard.onclick = () => {
      S.deckSelected = !S.deckSelected;
      if (S.deckSelected) S.drawCardId = null;
      render();
    };
  }
  drawCards.appendChild(deckCard);
  drawArea.appendChild(drawCards);
  piles.appendChild(drawArea);

  // Discard pile
  const discArea = el("div", "pile-area"); discArea.style.flex = "1";
  const prevBy = game.lastDiscardBy;
  const prevByName = prevBy ? pName(room, prevBy) : null;
  const discLabel = el("div", "pile-label");
  discLabel.textContent = prevByName ? `Last play · ${prevByName}` : "Centre pile";
  discArea.appendChild(discLabel);

  const discCards = el("div", "pile-cards");
  const visible = game.visibleDiscard || [];
  // Can pick from pile on your turn, from anyone else's discard (or initial card)
  const canPickFromPile = yourTurn && game.phase === "playing"
    && (prevBy === null || prevBy !== room.youId);

  visible.forEach((c) => {
    const isChosen = S.drawCardId === c.id;
    let extra = "";
    if (canPickFromPile) extra = isChosen ? "pick-selected" : "pickable";
    const cEl = makeCard(c, { extra });
    if (canPickFromPile) {
      cEl.title = "Tap to pick this card";
      cEl.onclick = () => {
        S.drawCardId = isChosen ? null : c.id;
        if (S.drawCardId) S.deckSelected = false;
        render();
      };
    }
    discCards.appendChild(cEl);
  });
  discArea.appendChild(discCards);
  piles.appendChild(discArea);
  col.appendChild(piles);

  // ── Your hand ──
  const inGame = game.yourHand && !game.isSpectator && !game.eliminated.includes(room.youId);
  if (inGame) {
    const handCard = el("div", "surface");
    const handHdr = el("div", "row between"); handHdr.style.marginBottom = "10px";
    const handTitle = el("div", "section-title"); handTitle.textContent = "Your hand";
    const handPts = el("div", "hand-pts"); handPts.textContent = `${handTotal(game.yourHand)} pts`;
    handHdr.appendChild(handTitle); handHdr.appendChild(handPts);
    handCard.appendChild(handHdr);

    const hand = el("div", "hand");
    const sorted = [...game.yourHand].sort((a, b) => a.rank - b.rank);
    sorted.forEach(c => {
      const isSelected = S.selected.has(c.id);
      const cEl = makeCard(c, { extra: isSelected ? "selected" : "" });
      if (yourTurn && game.phase === "playing") {
        cEl.onclick = () => {
          // Toggle selection WITHOUT clearing the draw source — any order is allowed
          if (S.selected.has(c.id)) S.selected.delete(c.id);
          else S.selected.add(c.id);
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

      const drawReady = S.deckSelected || !!S.drawCardId;
      const playReady = S.selected.size > 0 && drawReady;

      const declBtn = el("button", "btn-danger");
      declBtn.textContent = "Declare 🎯";
      declBtn.disabled = S.selected.size > 0;
      declBtn.title = "Declare that you have the lowest hand";
      declBtn.onclick = () => {
        if (!confirm("Declare? You'll score a penalty if someone has fewer points.")) return;
        socket.emit("game:action", { type: "declare" }, r => { if (!r.ok) alert(r.error); });
      };
      bar.appendChild(declBtn);

      const playBtn = el("button", "btn-success");
      playBtn.disabled = !playReady;
      if (!S.selected.size)         playBtn.textContent = "Select cards from hand";
      else if (!drawReady)          playBtn.textContent = `Tap deck or pile to draw`;
      else                          playBtn.textContent = `Play ${S.selected.size} card${S.selected.size > 1 ? "s" : ""}`;
      playBtn.onclick = () => {
        const cardIds = [...S.selected];
        const draw = S.deckSelected ? { source: "deck" } : { source: "discard", cardId: S.drawCardId };
        socket.emit("game:action", { type: "discard", cardIds, draw }, r => {
          if (!r.ok) { alert(r.error); return; }
          S.selected.clear(); S.drawCardId = null; S.deckSelected = false;
        });
      };
      bar.appendChild(playBtn);

      if (S.selected.size > 0 || drawReady) {
        const clrBtn = el("button", "btn-ghost");
        clrBtn.textContent = "Clear";
        clrBtn.onclick = () => { S.selected.clear(); S.drawCardId = null; S.deckSelected = false; render(); };
        bar.appendChild(clrBtn);
      }

      col.appendChild(bar);
    }
  } else if (game.phase === "playing") {
    const w = el("div", "hint hint-info");
    w.textContent = game.isSpectator
      ? `Spectating${game.showHandsToSpectators ? " — all hands visible" : ""}.`
      : "You've been eliminated. Watching the rest of the game.";
    col.appendChild(w);
    if (game.isSpectator && game.allHands) col.appendChild(renderAllHands(room, game));
  }

  return col;
}

// ── Right column: turn order ──────────────────────
function renderRightCol(room, game) {
  const col = el("div", "gap-10");
  const isHost = room.youId === room.hostId;

  // Turn order card
  const card = el("div", "surface gap-10");
  const cardTitle = el("div", "section-title"); cardTitle.textContent = "Turn order";
  card.appendChild(cardTitle);

  const list = el("div", "turn-order");
  const ids = game.playerIds || room.players.map(p => p.id);
  const yourTurnNow = game.currentTurnPlayerId === room.youId;

  ids.forEach((pid) => {
    const isElim   = game.eliminated.includes(pid);
    const isCurrent = pid === game.currentTurnPlayerId && game.phase === "playing";
    const isExpanded = S.expandedPid === pid;
    const p = room.players.find(x => x.id === pid);

    const row = el("div", `turn-row ${isCurrent ? "active" : ""} ${isElim ? "out" : ""}`);
    const indicator = el("div", "turn-indicator");
    const nameSpan = el("div", "turn-name");
    const nameText = p?.name ?? "?";
    const isYou = pid === room.youId;

    let nameParts = esc(nameText);
    if (isYou) nameParts += ` <span class="you-label">(you)</span>`;
    if (isElim) nameParts += ` <span class="tag tag-out">Out</span>`;
    if (isCurrent && !isElim) nameParts += ` <span class="cur-arrow">▶</span>`;
    nameSpan.innerHTML = nameParts;

    // Timer (only on current player's row)
    const timerEl = el("div", "turn-timer-cell");
    if (isCurrent && game.turnEndsAt && game.phase === "playing") {
      const secs = Math.max(0, Math.ceil((game.turnEndsAt - Date.now()) / 1000));
      timerEl.textContent = `${secs}s`;
      timerEl.className = "turn-timer-cell";
      clearTimeout(window._timerTick); window._timerTick = setTimeout(render, 1000);
    }

    row.appendChild(indicator); row.appendChild(nameSpan); row.appendChild(timerEl);

    // Cards played this round
    const played = game.lastPlayedThisRound?.[pid];
    if (played?.cards?.length) {
      const playedDiv = el("div", "turn-played");
      played.cards.slice(0, 4).forEach(c => {
        const mc = el("span", `mini-card${RED.has(c.suit) ? " red" : ""}`);
        mc.textContent = RANK_LABEL(c.rank) + SUIT_SYM[c.suit];
        playedDiv.appendChild(mc);
      });
      if (played.cards.length > 4) {
        const mc = el("span", "mini-card"); mc.textContent = `+${played.cards.length - 4}`;
        playedDiv.appendChild(mc);
      }
      row.appendChild(playedDiv);
    }

    // Host can tap a player row to reveal kick button
    if (isHost && pid !== room.youId && !isElim) {
      row.style.cursor = "pointer";
      row.onclick = () => {
        S.expandedPid = isExpanded ? null : pid;
        render();
      };
    }

    list.appendChild(row);

    // Expanded host action row
    if (isHost && isExpanded && pid !== room.youId) {
      const actionRow = el("div", "host-action-row");
      actionRow.innerHTML = `<span style="color:#94a3b8;font-size:.85rem">${esc(p?.name ?? "?")}</span>`;
      const kickBtn = el("button", "btn-danger btn-sm"); kickBtn.textContent = "Kick from game";
      kickBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Kick ${p?.name ?? "this player"}?`)) {
          socket.emit("room:kick", { playerId: pid });
          S.expandedPid = null;
        }
      };
      actionRow.appendChild(kickBtn);
      list.appendChild(actionRow);
    }
  });

  card.appendChild(list);

  // Timer hint for your turn
  if (yourTurnNow && game.phase === "playing") {
    const yourTurnHint = el("div", "hint hint-success");
    yourTurnHint.textContent = "It's your turn! Pick cards from your hand, then tap the deck or a pile card.";
    card.appendChild(yourTurnHint);
  }

  col.appendChild(card);
  return col;
}

// ── All hands reveal ──────────────────────────────
function renderAllHands(room, game) {
  const wrap = el("div", "surface gap-10");
  const t = el("div", "section-title");
  t.textContent = game.phase === "roundEnd" ? "All hands" : "Final hands";
  wrap.appendChild(t);
  const all = el("div", "all-hands");
  for (const [pid, h] of Object.entries(game.allHands || {})) {
    const div = el("div", "hand-reveal");
    const hdr = el("div", "hand-reveal-header");
    const p = room.players.find(x => x.id === pid);
    hdr.innerHTML = `<div class="hand-reveal-name">${esc(p?.name ?? "?")}${pid === game.declarerId ? ' <span class="tag tag-decl">Declared</span>' : ""}</div><div class="hand-pts">${handTotal(h)} pts</div>`;
    div.appendChild(hdr);
    const handDiv = el("div", "hand");
    [...h].sort((a, b) => a.rank - b.rank).forEach(c => handDiv.appendChild(makeCard(c)));
    div.appendChild(handDiv);
    all.appendChild(div);
  }
  wrap.appendChild(all);
  return wrap;
}

// ── Round end banner ──────────────────────────────
function renderRoundEnd(room, game) {
  const d = game.roundEndDetail || {};
  const decName = pName(room, game.declarerId);
  let msg = "";
  if (d.case === "declarerLowest") msg = `${decName} declared and had the lowest hand — scores 0 this round.`;
  else if (d.case === "tie")       msg = `${decName} declared and tied for the lowest hand — scores 0.`;
  else if (d.case === "penalty") {
    const low = (d.lowestPids || []).map(id => pName(room, id)).join(" & ");
    msg = `${decName} declared, but ${low || "another player"} had a lower hand. ${decName} takes a +${d.penalty ?? 50} penalty.`;
  }
  const wrap = el("div", "surface gap-10");
  const banner = el("div", "result-banner");
  banner.innerHTML = `<div class="result-msg">${esc(msg)}</div>`;
  wrap.appendChild(banner);

  if (d.newlyEliminated?.length) {
    const e = el("div", "hint hint-warn");
    e.textContent = `Eliminated: ${d.newlyEliminated.map(id => pName(room, id)).join(", ")}`;
    wrap.appendChild(e);
  }

  if (room.youId === room.hostId) {
    const btn = el("button", "btn-success"); btn.textContent = "Start next round →";
    btn.onclick = () => socket.emit("game:nextRound");
    wrap.appendChild(btn);
  } else {
    const w = el("div", "hint hint-info"); w.textContent = "Waiting for host to start the next round…";
    wrap.appendChild(w);
  }
  return wrap;
}

// ── Game end ──────────────────────────────────────
function renderGameEnd(room, game) {
  const winner = room.players.find(p => p.id === game.winnerId);
  const wrap = el("div", "gap-12");

  const banner = el("div", "surface result-banner");
  banner.innerHTML = `<div style="font-size:2rem;margin-bottom:8px">🏆</div><div style="font-size:1.5rem;font-weight:800;color:#f1f5f9">${winner ? esc(winner.name) + " wins!" : "Game over"}</div>`;
  wrap.appendChild(banner);

  if (game.allHands) wrap.appendChild(renderAllHands(room, game));

  const statsCard = el("div", "surface gap-10");
  const stTitle = el("div", "section-title"); stTitle.textContent = "Match stats";
  statsCard.appendChild(stTitle);
  const grid = el("div", "stat-grid");
  for (const s of buildStats(room, game)) {
    const c = el("div", "stat-card");
    c.innerHTML = `<div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div>${s.detail ? `<div class="stat-detail">${esc(s.detail)}</div>` : ""}`;
    grid.appendChild(c);
  }
  statsCard.appendChild(grid);
  wrap.appendChild(statsCard);

  if (room.youId === room.hostId) {
    const btn = el("button", "btn-ghost"); btn.textContent = "Return to lobby";
    btn.onclick = () => socket.emit("game:resetLobby");
    wrap.appendChild(btn);
  }
  return wrap;
}

function buildStats(room, game) {
  const all = room.players; const st = game.stats || {}; const out = [];
  const n = pid => pid ? pName(room, pid) : "—";
  const best = (key, cmp) => {
    let winner = null, val = cmp === "min" ? Infinity : -1;
    for (const p of all) {
      const v = st[p.id]?.[key] ?? (cmp === "min" ? Infinity : 0);
      if (cmp === "min" ? v < val : v > val) { winner = p.id; val = v; }
    }
    return { winner, val };
  };
  const { winner: la } = best("totalRoundScore", "min");
  const avg = la ? ((st[la]?.totalRoundScore ?? 0) / Math.max(1, st[la]?.roundsPlayed ?? 1)).toFixed(1) : "—";
  out.push({ label: "Lowest avg score", value: n(la), detail: `${avg} pts/round` });
  const { winner: dw, val: dwv } = best("declarationsWon", "max");
  out.push({ label: "Most declarations won", value: n(dw), detail: `${dwv} wins` });
  const { winner: df, val: dfv } = best("declarationsFailed", "max");
  out.push({ label: "Most failed declarations", value: n(df), detail: `${dfv} failed` });
  const { winner: bh, val: bhv } = best("bestHandTotal", "min");
  out.push({ label: "Lowest hand achieved", value: n(bh), detail: bhv !== Infinity ? `${bhv} pts` : "" });
  const { winner: sq, val: sqv } = best("sequencesPlayed", "max");
  out.push({ label: "Most sequences", value: n(sq), detail: `${sqv} sequences` });
  const { winner: qu, val: quv } = best("quadsPlayed", "max");
  out.push({ label: "Most quads", value: n(qu), detail: `${quv} quads` });
  const { winner: cd, val: cdv } = best("cardsDiscarded", "max");
  out.push({ label: "Most cards played", value: n(cd), detail: `${cdv} total` });
  const { winner: lo, val: lov } = best("timesLowest", "max");
  out.push({ label: "Most often lowest hand", value: n(lo), detail: `${lov} rounds` });
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
function closeModal() { S.modal = null; render(); }

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
  if      (S.modal === "chat")     { title.textContent = "Chat";         body.appendChild(renderChatBody()); }
  else if (S.modal === "rules")    { title.textContent = "How to play";  body.appendChild(renderRulesBody()); }
  else if (S.modal === "cardback") { title.textContent = "Card back";    body.appendChild(renderCardBackBody()); }
  else if (S.modal === "settings") { title.textContent = "Settings & Rules"; body.appendChild(renderSettingsBody()); }
  else if (S.modal === "scores")   { title.textContent = "Leaderboard";  body.appendChild(renderScoresBody()); }
  modal.appendChild(body);
  bg.appendChild(modal);
  return bg;
}

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
  const inp = el("input", ""); inp.id = "chat-in"; inp.placeholder = "Message…"; inp.maxLength = 200;
  inp.autocomplete = "off"; inp.value = S.chatInput;
  inp.oninput = e => { S.chatInput = e.target.value; };
  const sendBtn = el("button", "btn-primary"); sendBtn.textContent = "Send";
  form.appendChild(inp); form.appendChild(sendBtn);
  form.onsubmit = e => {
    e.preventDefault();
    const text = inp.value.trim();
    if (!text) return;
    socket.emit("chat:send", { text });
    inp.value = ""; S.chatInput = "";
    if (S.room?.chat) S.chatSeenLen = S.room.chat.length + 1;
  };
  wrap.appendChild(form);
  setTimeout(() => {
    const i = document.getElementById("chat-in");
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }, 50);
  return wrap;
}

// ── Leaderboard ───────────────────────────────────
function renderScoresBody() {
  const room = state(); const game = room.game; if (!game) return el("div", "");
  const wrap = el("div", "score-list");
  const sorted = [...room.players].sort((a, b) => {
    const ea = game.eliminated.includes(a.id) ? 1 : 0;
    const eb = game.eliminated.includes(b.id) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return (game.cumulativeScores[a.id] ?? 0) - (game.cumulativeScores[b.id] ?? 0);
  });
  const medals = ["🥇", "🥈", "🥉"];
  sorted.forEach((p, i) => {
    const elim = game.eliminated.includes(p.id);
    const row = el("div", `score-item ${elim ? "out" : ""}`);
    const left = el("div", "score-left");
    left.innerHTML = `<span>${medals[i] ?? ""}</span><span class="dot ${p.connected ? "" : "off"}"></span><span>${esc(p.name)}${p.id === room.youId ? " (you)" : ""}</span>${elim ? '<span class="tag tag-out">Out</span>' : ""}`;
    const pts = el("div", "score-pts");
    if (game.lastRoundScores?.[p.id] !== undefined)
      pts.textContent = `+${game.lastRoundScores[p.id]} → ${game.cumulativeScores[p.id] ?? 0}`;
    else
      pts.textContent = game.mode === "setpoints"
        ? `${game.cumulativeScores[p.id] ?? 0} / ${game.pointLimit}`
        : (elim ? "Out" : `${game.handCounts?.[p.id] ?? 0} cards`);
    row.appendChild(left); row.appendChild(pts);
    wrap.appendChild(row);
  });
  return wrap;
}

// ── Rules ─────────────────────────────────────────
function renderRulesBody() {
  const wrap = el("div", "gap-16");
  const room = state();
  const game = room?.game;

  // Show active rules when a game is running
  if (game && game.phase === "playing" && game.rules) {
    const r = game.rules;
    const activeSection = el("div", "surface surface-sm gap-8");
    activeSection.style.background = "#0c1e3a";
    const at = el("div", "section-title"); at.textContent = "Active rules for this game";
    activeSection.appendChild(at);

    const items = [
      [`Starting hand size`, `${r.startingHandSize ?? 5} cards`],
      [`Declaration penalty`, `+${r.declarationPenalty ?? 50} pts`],
      [`Triplets`, r.allowTriplets ? "Enabled" : "Disabled"],
      [`4-card sequences`, r.allow4Seq ? "Enabled" : "Disabled"],
      [`6+ card sequences`, r.allow6PlusSeq ? "Enabled" : "Disabled"],
      [`Wrap-around sequences (K-A-2)`, r.allowWrapAround ? "Enabled" : "Disabled"],
    ];
    const grid = el("div", "active-rules-grid");
    items.forEach(([label, val]) => {
      const row = el("div", "active-rule-row");
      row.innerHTML = `<span class="active-rule-label">${esc(label)}</span><span class="active-rule-val">${esc(val)}</span>`;
      grid.appendChild(row);
    });
    activeSection.appendChild(grid);
    wrap.appendChild(activeSection);
  }

  wrap.innerHTML += `
    <p>Each player holds a hand of cards. Have the <b>lowest hand total</b> when someone declares. Aces = 1 pt, face cards = 10 pts, all others face value.</p>
    <div class="gap-8">
      <div class="section-title">Each turn</div>
      <p>Either <b>Declare</b> (end the round) or <b>Discard</b> a valid set and draw one replacement card. You can choose a draw source <em>before or after</em> selecting cards from your hand.</p>
    </div>
    <div class="gap-8">
      <div class="section-title">Valid discards</div>
    </div>
  `;

  const exWrap = el("div", "gap-8");
  [
    ["Single card", [{ r: 7, s: "H" }]],
    ["Pair — same rank", [{ r: 9, s: "S" }, { r: 9, s: "D" }]],
    ["Four of a kind", [{ r: 5, s: "S" }, { r: 5, s: "H" }, { r: 5, s: "D" }, { r: 5, s: "C" }]],
    ["3-card sequence (any suits)", [{ r: 4, s: "S" }, { r: 5, s: "H" }, { r: 6, s: "D" }]],
    ["Ace always high in sequences (Q–K–A)", [{ r: 12, s: "S" }, { r: 13, s: "H" }, { r: 1, s: "D" }]],
  ].forEach(([label, cards]) => {
    const g = el("div", "gap-4");
    const lEl = el("div", ""); lEl.style.fontWeight = "600"; lEl.style.color = "#e2e8f0"; lEl.textContent = label;
    const ex = el("div", "example-row");
    cards.forEach(({ r, s }) => ex.appendChild(makeCard({ id: `ex${r}${s}`, rank: r, suit: s })));
    g.appendChild(lEl); g.appendChild(ex);
    exWrap.appendChild(g);
  });
  wrap.appendChild(exWrap);

  const rules2 = el("div", "gap-16");
  rules2.innerHTML = `
    <div class="gap-8">
      <div class="section-title">Picking up from the pile</div>
      <p>You can pick <b>any card</b> from the previous player's discarded set — not just the top card. Works for singles, pairs, quads, and sequences. Tap the card you want.</p>
    </div>
    <div class="gap-8">
      <div class="section-title">Declaration outcomes</div>
      <p><b>You have the lowest hand</b> → you score 0, others score their hand totals.<br>
      <b>Tied for the lowest</b> → you score 0.<br>
      <b>Someone else is lower</b> → you take the penalty (set by host), that player scores 0.</p>
    </div>
    <div class="gap-8">
      <div class="section-title">Game modes</div>
      <p><b>Set Points:</b> scores accumulate across rounds. Reach the point limit and you're eliminated. Last player standing wins.<br>
      <b>Elimination:</b> the player with the highest score each round is eliminated.</p>
    </div>
  `;
  wrap.appendChild(rules2);
  return wrap;
}

// ── Card back picker ──────────────────────────────
function renderCardBackBody() {
  const me = S.room?.players.find(p => p.id === S.room.youId) || {};
  const wrap = el("div", "gap-12");
  const grid = el("div", "cb-grid");
  CARD_BACKS.forEach(cb => {
    const opt = el("div", `cb-option${me.cardBack === cb.id ? " selected" : ""}`);
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

// ── Settings & Rules (combined) ───────────────────
function renderSettingsBody() {
  const room = state();
  const isHost = room.youId === room.hostId && !room.started;
  const r = room.settings.rules;
  const s = room.settings;
  const wrap = el("div", "gap-12");

  if (!isHost) {
    const note = el("div", "hint hint-info");
    note.textContent = "Only the host can change settings before the game starts.";
    wrap.appendChild(note);
  }

  // Game setup section
  const setupTitle = el("div", "section-title"); setupTitle.textContent = "Game setup";
  wrap.appendChild(setupTitle);

  if (isHost) {
    const modeLabel = el("label"); modeLabel.textContent = "Mode";
    const modeSelect = el("select");
    modeSelect.innerHTML = `
      <option value="setpoints"${s.mode==="setpoints"?" selected":""}>Set Points — accumulate scores, hit the limit and you're out</option>
      <option value="elimination"${s.mode==="elimination"?" selected":""}>Elimination — highest score each round is eliminated</option>`;

    const limitWrap = el("div", "gap-4"); limitWrap.style.display = s.mode === "setpoints" ? "" : "none";
    const limitLabel = el("label"); limitLabel.textContent = "Point limit";
    const limitInput = el("input"); limitInput.type = "number"; limitInput.min = "10"; limitInput.value = s.pointLimit;
    limitWrap.appendChild(limitLabel); limitWrap.appendChild(limitInput);

    const timerLabel = el("label"); timerLabel.textContent = "Turn timer";
    const timerSelect = el("select");
    timerSelect.innerHTML = `<option value="0"${!s.turnTimer?" selected":""}>No timer</option><option value="30"${s.turnTimer===30?" selected":""}>30 seconds</option><option value="60"${s.turnTimer===60?" selected":""}>60 seconds</option>`;

    wrap.appendChild(modeLabel); wrap.appendChild(modeSelect);
    wrap.appendChild(limitWrap);
    wrap.appendChild(timerLabel); wrap.appendChild(timerSelect);

    const sendBasic = () => socket.emit("room:settings", {
      mode: modeSelect.value, pointLimit: Number(limitInput.value || 100),
      turnTimer: Number(timerSelect.value),
    });
    modeSelect.onchange = () => { limitWrap.style.display = modeSelect.value === "setpoints" ? "" : "none"; sendBasic(); };
    limitInput.onchange = sendBasic; timerSelect.onchange = sendBasic;
  } else {
    const info = el("div", "hint hint-info");
    info.innerHTML = `Mode: <b>${s.mode === "setpoints" ? `Set Points (to ${s.pointLimit})` : "Elimination"}</b> · Timer: <b>${s.turnTimer ? s.turnTimer + "s" : "None"}</b>`;
    wrap.appendChild(info);
  }

  const div2 = el("div", "divider"); wrap.appendChild(div2);

  // Custom rules section
  const rulesTitle = el("div", "section-title"); rulesTitle.textContent = "Custom rules";
  wrap.appendChild(rulesTitle);

  const handLabel = el("label"); handLabel.textContent = "Starting hand size";
  const handInput = el("input"); handInput.type = "number"; handInput.min = "3"; handInput.max = "10";
  handInput.value = r.startingHandSize; handInput.disabled = !isHost;
  const penLabel = el("label"); penLabel.textContent = "Declaration penalty (pts)";
  const penInput = el("input"); penInput.type = "number"; penInput.min = "0"; penInput.max = "500";
  penInput.value = r.declarationPenalty; penInput.disabled = !isHost;
  wrap.appendChild(handLabel); wrap.appendChild(handInput);
  wrap.appendChild(penLabel); wrap.appendChild(penInput);

  [
    ["allowTriplets",   "Allow triplets",              "Discard three of the same rank"],
    ["allow4Seq",       "Allow 4-card sequences",      "e.g. 5-6-7-8 across any suits"],
    ["allow6PlusSeq",   "Allow 6+ card sequences",     "Long sequences of 6 or more cards"],
    ["allowWrapAround", "Allow wrap-around (K-A-2)",   "Sequences can span King through Ace"],
  ].forEach(([key, label, desc]) => {
    wrap.appendChild(buildToggle(label, desc, r[key], isHost,
      () => socket.emit("room:settings", { rules: { [key]: !r[key] } })));
  });
  wrap.appendChild(buildToggle(
    "Spectators see all hands", "Eliminated players can view everyone's cards",
    !!s.showHandsToSpectators, isHost,
    () => socket.emit("room:settings", { showHandsToSpectators: !s.showHandsToSpectators })
  ));

  if (isHost) {
    const sendRules = () => socket.emit("room:settings", { rules: {
      startingHandSize: Number(handInput.value || 5),
      declarationPenalty: Number(penInput.value ?? 50),
    }});
    handInput.onchange = sendRules; penInput.onchange = sendRules;
  }
  return wrap;
}

function buildToggle(label, desc, value, enabled, fn) {
  const row = el("div", "toggle-row");
  row.innerHTML = `<div class="toggle-info"><b>${esc(label)}</b><small>${esc(desc)}</small></div>`;
  const tog = el("div", `toggle${value ? " on" : ""}${enabled ? "" : " disabled"}`);
  if (enabled) tog.onclick = fn;
  row.appendChild(tog);
  return row;
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function state()  { return S.room; }
function pName(room, pid) { return room.players.find(x => x.id === pid)?.name ?? "?"; }
function myBack(room) { return room.players.find(p => p.id === room.youId)?.cardBack ?? "classic-blue"; }
function unread() { return Math.max(0, (S.room?.chat?.length ?? 0) - S.chatSeenLen); }
function handTotal(hand) { return (hand || []).reduce((s, c) => s + (c.rank <= 10 ? c.rank : 10), 0); }

function makeCard(c, { faceDown = false, cardBack = "classic-blue", extra = "" } = {}) {
  const div = el("div", `card${extra ? " " + extra : ""}`);
  if (!c || faceDown) {
    // FIX: prefix with "cb-" to match CSS class names
    div.classList.add("cb-" + cardBack);
    return div;
  }
  if (RED.has(c.suit)) div.classList.add("red");
  div.innerHTML = `<div class="rank">${RANK_LABEL(c.rank)}</div><div class="suit-big">${SUIT_SYM[c.suit]}</div>`;
  return div;
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => showToast("Link copied!")).catch(() => prompt("Copy:", t));
}

render();
