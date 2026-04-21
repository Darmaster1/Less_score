// Least Score — game logic
// Cards: { id, suit, rank }  rank: 1=A, 2..10, 11=J, 12=Q, 13=K
// Value: rank<=10 ? rank : 10  (Ace=1)

const SUITS = ["S", "H", "D", "C"];

export function buildDeck() {
  const deck = [];
  let id = 0;
  for (const s of SUITS) {
    for (let r = 1; r <= 13; r++) {
      deck.push({ id: `c${id++}_${s}${r}`, suit: s, rank: r });
    }
  }
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardValue(c) {
  return c.rank <= 10 ? c.rank : 10;
}

export function handTotal(hand) {
  return hand.reduce((s, c) => s + cardValue(c), 0);
}

/**
 * Validate a discard set.
 * Returns { ok, type, error }
 */
export function validateDiscard(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return { ok: false, error: "No cards selected" };
  const ranks = cards.map((c) => c.rank);
  const uniq = [...new Set(ranks)];

  if (cards.length === 1) return { ok: true, type: "single" };
  if (cards.length === 2 && uniq.length === 1) return { ok: true, type: "pair" };
  if (cards.length === 4 && uniq.length === 1) return { ok: true, type: "quad" };
  if (cards.length === 3 && uniq.length === 3 && isSequential(ranks)) return { ok: true, type: "seq3" };
  if (cards.length === 5 && uniq.length === 5 && isSequential(ranks)) return { ok: true, type: "seq5" };

  if (cards.length === 3 && uniq.length === 1) return { ok: false, error: "Triplets not allowed" };
  if (cards.length === 4 && uniq.length === 4 && isSequential(ranks))
    return { ok: false, error: "4-card sequence not allowed" };
  return { ok: false, error: "Invalid discard combination" };
}

function isSequential(ranks) {
  const sorted = ranks.slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  // No wrap-around (K-A-2 not allowed) — naturally enforced since 13 -> 1 not consecutive
  return true;
}

export function createGame(playerIds, settings, prevState = null) {
  const deck = buildDeck();
  const hands = {};
  for (const pid of playerIds) {
    hands[pid] = deck.splice(0, 5);
  }
  const firstDiscard = deck.splice(0, 1);
  const game = {
    phase: "playing",
    mode: settings.mode,
    pointLimit: settings.pointLimit,
    turnTimer: settings.turnTimer,
    turnEndsAt: null,
    playerIds: playerIds.slice(),
    currentTurnPlayerId: playerIds[0],
    drawPile: deck,
    discardPile: firstDiscard,
    lastDiscardWasSequence: false,
    lastDiscardSize: 1,
    hands,
    eliminated: prevState ? prevState.eliminated.slice() : [],
    cumulativeScores: prevState ? { ...prevState.cumulativeScores } : Object.fromEntries(playerIds.map((p) => [p, 0])),
    lastRoundScores: null,
    log: [],
    winnerId: null,
    declarerId: null,
    roundEndDetail: null,
    hasPlayedThisTurn: false,
  };
  // ensure cumulativeScores has all current playerIds
  for (const pid of playerIds) if (!(pid in game.cumulativeScores)) game.cumulativeScores[pid] = 0;
  return game;
}

function advanceTurn(game) {
  const idx = game.playerIds.indexOf(game.currentTurnPlayerId);
  let next = idx;
  for (let i = 1; i <= game.playerIds.length; i++) {
    next = (idx + i) % game.playerIds.length;
    const pid = game.playerIds[next];
    if (!game.eliminated.includes(pid)) {
      game.currentTurnPlayerId = pid;
      game.hasPlayedThisTurn = false;
      return;
    }
  }
}

function reshuffleIfNeeded(game) {
  if (game.drawPile.length === 0) {
    // bring in a fresh deck
    game.drawPile = buildDeck();
    game.log.push({ t: Date.now(), msg: "Draw pile empty — fresh deck shuffled in." });
  }
}

/**
 * action: { type: 'declare' } | { type: 'discard', cardIds, draw: { source: 'deck'|'discard', cardId? } }
 */
export function applyAction(game, playerId, action) {
  if (game.phase !== "playing") return { ok: false, error: "not playing" };
  if (game.currentTurnPlayerId !== playerId) return { ok: false, error: "not your turn" };

  if (action.type === "declare") {
    if (game.hasPlayedThisTurn) return { ok: false, error: "Cannot declare after playing" };
    return doDeclare(game, playerId);
  }

  if (action.type === "discard") {
    if (game.hasPlayedThisTurn) return { ok: false, error: "Already played this turn" };
    return doDiscardAndDraw(game, playerId, action);
  }

  return { ok: false, error: "Unknown action" };
}

function doDiscardAndDraw(game, playerId, action) {
  const hand = game.hands[playerId];
  const cardIds = action.cardIds || [];
  const cards = cardIds.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
  if (cards.length !== cardIds.length) return { ok: false, error: "Card not in hand" };

  const v = validateDiscard(cards);
  if (!v.ok) return v;

  // remove from hand
  game.hands[playerId] = hand.filter((c) => !cardIds.includes(c.id));

  // place on discard pile (top of pile = end of array)
  // We treat discardPile as: the BOTTOM is index 0, TOP is end
  // For sequences we keep all 3 or 5 visible; remaining stay after pickup
  for (const c of cards) game.discardPile.push(c);
  game.lastDiscardWasSequence = v.type === "seq3" || v.type === "seq5";
  game.lastDiscardSize = cards.length;

  // Draw
  const drawSrc = action.draw && action.draw.source;
  let drawnCard = null;
  if (drawSrc === "deck") {
    reshuffleIfNeeded(game);
    drawnCard = game.drawPile.shift();
    if (drawnCard) game.hands[playerId].push(drawnCard);
  } else if (drawSrc === "discard") {
    if (game.lastDiscardWasSequence) {
      // pick any one card from the just-discarded sequence
      const wantedId = action.draw.cardId;
      const seqStart = game.discardPile.length - cards.length;
      const seqIdxInPile = game.discardPile.findIndex((c, i) => i >= seqStart && c.id === wantedId);
      if (seqIdxInPile === -1) return { ok: false, error: "Pick must be from the just-discarded sequence" };
      drawnCard = game.discardPile.splice(seqIdxInPile, 1)[0];
      game.hands[playerId].push(drawnCard);
      // If the picked card was the only one taken, pile keeps remaining; sequence is "broken"
      game.lastDiscardWasSequence = false; // can't pick again from it
    } else {
      // top of discard pile (which is the last card just discarded — that's odd but allowed by rules)
      drawnCard = game.discardPile.pop();
      if (drawnCard) game.hands[playerId].push(drawnCard);
    }
  } else {
    return { ok: false, error: "Specify draw source" };
  }

  game.hasPlayedThisTurn = true;

  const msg = `{you} discarded ${describeSet(cards, v.type)} and drew from ${
    drawSrc === "deck" ? "the deck" : "the discard pile"
  }.`;

  advanceTurn(game);

  return { ok: true, message: msg };
}

function describeSet(cards, type) {
  const names = cards.map(rankName).join(", ");
  const labels = { single: "a single", pair: "a pair", quad: "four-of-a-kind", seq3: "a 3-card sequence", seq5: "a 5-card sequence" };
  return `${labels[type] || type} (${names})`;
}

function rankName(c) {
  const map = { 1: "A", 11: "J", 12: "Q", 13: "K" };
  return map[c.rank] || String(c.rank);
}

function doDeclare(game, playerId) {
  game.declarerId = playerId;
  // Compute totals
  const totals = {};
  for (const pid of game.playerIds) {
    if (game.eliminated.includes(pid)) continue;
    totals[pid] = handTotal(game.hands[pid]);
  }
  const declarerTotal = totals[playerId];

  const others = Object.entries(totals).filter(([pid]) => pid !== playerId);
  const minOther = others.length ? Math.min(...others.map(([, v]) => v)) : Infinity;
  const tiedWithDeclarer = others.filter(([, v]) => v === declarerTotal).map(([pid]) => pid);

  const roundScores = {};
  let detail;

  if (declarerTotal < minOther) {
    // Case 1: declarer strictly lowest
    roundScores[playerId] = 0;
    for (const [pid, v] of others) roundScores[pid] = v;
    detail = { case: "declarerLowest" };
  } else if (declarerTotal === minOther) {
    // Case 2: tie for lowest
    roundScores[playerId] = 0;
    for (const [pid, v] of others) roundScores[pid] = v;
    detail = { case: "tie", tiedWith: tiedWithDeclarer };
  } else {
    // Case 3: someone else is lower
    roundScores[playerId] = 50;
    // The actual lowest other player(s) = 0
    const lowestPids = others.filter(([, v]) => v === minOther).map(([pid]) => pid);
    for (const [pid, v] of others) {
      roundScores[pid] = lowestPids.includes(pid) ? 0 : v;
    }
    detail = { case: "penalty", lowestPids };
  }

  game.lastRoundScores = roundScores;
  game.roundEndDetail = detail;

  // Update cumulative
  for (const [pid, s] of Object.entries(roundScores)) {
    game.cumulativeScores[pid] = (game.cumulativeScores[pid] || 0) + s;
  }

  // Apply elimination by mode
  const newlyEliminated = [];
  if (game.mode === "setpoints") {
    for (const pid of Object.keys(roundScores)) {
      if (!game.eliminated.includes(pid) && game.cumulativeScores[pid] >= game.pointLimit) {
        game.eliminated.push(pid);
        newlyEliminated.push(pid);
      }
    }
  } else if (game.mode === "elimination") {
    // highest of this round eliminated
    let maxScore = -Infinity;
    for (const v of Object.values(roundScores)) if (v > maxScore) maxScore = v;
    for (const [pid, v] of Object.entries(roundScores)) {
      if (v === maxScore) {
        if (!game.eliminated.includes(pid)) {
          game.eliminated.push(pid);
          newlyEliminated.push(pid);
        }
      }
    }
  }

  detail.newlyEliminated = newlyEliminated;

  game.phase = "roundEnd";
  game.turnEndsAt = null;

  // Determine winner
  const remaining = game.playerIds.filter((p) => !game.eliminated.includes(p));
  if (remaining.length <= 1) {
    game.phase = "gameEnd";
    game.winnerId = remaining[0] || null;
  }

  return { ok: true, message: `{you} declared! Round ended.` };
}

/**
 * Build a random valid auto-action for timer expiry.
 */
export function randomValidAuto(game, playerId) {
  const hand = game.hands[playerId];
  // Find a single card to discard at minimum
  const findValidSet = () => {
    // Try to find a valid set: prefer single
    if (hand.length === 0) return null;
    // pick highest-value single to reduce points
    const sorted = hand.slice().sort((a, b) => cardValue(b) - cardValue(a));
    return [sorted[0].id];
  };

  if (hand.length === 0) {
    // shouldn't happen; just draw and skip
    return { type: "discard", cardIds: [], draw: { source: "deck" } };
  }
  return { type: "discard", cardIds: findValidSet(), draw: { source: "deck" } };
}
