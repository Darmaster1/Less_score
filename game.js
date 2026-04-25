// Less Score — game logic
// Cards: { id, suit, rank }  rank: 1=A, 2..10, 11=J, 12=Q, 13=K
// Value: rank<=10 ? rank : 10  (Ace=1)

const SUITS = ["S", "H", "D", "C"];

export const DEFAULT_RULES = {
  startingHandSize: 5,
  allowTriplets: false,
  allow4Seq: false,
  allow6PlusSeq: false,
  allowWrapAround: false,
  declarationPenalty: 50,
  acesHigh: false, // if true, Ace also worth 11 for sequences (A-2-3 OR Q-K-A)
};

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
 * Validate a discard set against rules.
 */
export function validateDiscard(cards, rules = DEFAULT_RULES) {
  if (!Array.isArray(cards) || cards.length === 0)
    return { ok: false, error: "No cards selected" };
  const ranks = cards.map((c) => c.rank);
  const uniq = [...new Set(ranks)];

  if (cards.length === 1) return { ok: true, type: "single" };
  if (cards.length === 2 && uniq.length === 1) return { ok: true, type: "pair" };
  if (cards.length === 3 && uniq.length === 1) {
    if (rules.allowTriplets) return { ok: true, type: "triplet" };
    return { ok: false, error: "Triplets not allowed (host can enable)" };
  }
  if (cards.length === 4 && uniq.length === 1) return { ok: true, type: "quad" };

  // Sequences
  if (uniq.length === cards.length && cards.length >= 3) {
    const seqOk = isSequential(ranks, rules.allowWrapAround);
    if (seqOk) {
      if (cards.length === 3) return { ok: true, type: "seq3" };
      if (cards.length === 4) {
        if (rules.allow4Seq) return { ok: true, type: "seq4" };
        return { ok: false, error: "4-card sequence not allowed (host can enable)" };
      }
      if (cards.length === 5) return { ok: true, type: "seq5" };
      if (cards.length >= 6) {
        if (rules.allow6PlusSeq) return { ok: true, type: `seq${cards.length}` };
        return { ok: false, error: "6+ card sequences not allowed (host can enable)" };
      }
    }
  }
  return { ok: false, error: "Invalid discard combination" };
}

function isSequential(ranks, allowWrap) {
  const sorted = ranks.slice().sort((a, b) => a - b);
  // Standard ascending check (Ace as 1)
  let consecutive = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) { consecutive = false; break; }
  }
  if (consecutive) return true;
  // Ace HIGH — always allowed: Q-K-A, J-Q-K-A, 10-J-Q-K-A, etc.
  if (sorted[0] === 1) {
    const alt = sorted.slice(1).concat([14]).sort((a, b) => a - b);
    let ok = true;
    for (let i = 1; i < alt.length; i++)
      if (alt[i] !== alt[i - 1] + 1) { ok = false; break; }
    if (ok) return true;
  }
  // True wrap-around (K-A-2, Q-K-A-2, etc.) — host toggle
  if (allowWrap && sorted.includes(1) && sorted.includes(13)) {
    const set = new Set(sorted);
    for (let start = 1; start <= 13; start++) {
      let ok = true;
      for (let i = 0; i < sorted.length; i++) {
        const want = ((start - 1 + i) % 13) + 1;
        if (!set.has(want)) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

function emptyStats() {
  return {
    roundsPlayed: 0,
    declarationsMade: 0,
    declarationsWon: 0,
    declarationsFailed: 0,
    timesLowest: 0, // ended round with lowest hand (whether or not declared)
    sequencesPlayed: 0,
    quadsPlayed: 0,
    pairsPlayed: 0,
    cardsDiscarded: 0,
    bestHandTotal: Infinity, // lowest hand at end of any round
    totalRoundScore: 0,
  };
}

export function createGame(playerIds, settings, prevState = null) {
  const rules = { ...DEFAULT_RULES, ...(settings.rules || {}) };
  const deck = buildDeck();
  const hands = {};
  const handSize = Math.max(2, Math.min(10, rules.startingHandSize || 5));
  for (const pid of playerIds) {
    hands[pid] = deck.splice(0, handSize);
  }
  const firstDiscard = deck.splice(0, 1);
  // Random starting player each round
  const startIdx = Math.floor(Math.random() * playerIds.length);
  const game = {
    phase: "playing",
    mode: settings.mode,
    pointLimit: settings.pointLimit,
    turnTimer: settings.turnTimer,
    rules,
    showHandsToSpectators: !!settings.showHandsToSpectators,
    turnEndsAt: null,
    playerIds: playerIds.slice(),
    currentTurnPlayerId: playerIds[startIdx],
    drawPile: deck,
    discardPile: firstDiscard,
    lastDiscardWasSequence: false,
    lastDiscardSize: 1,
    lastDiscardBy: null,
    hands,
    eliminated: prevState ? prevState.eliminated.slice() : [],
    cumulativeScores: prevState
      ? { ...prevState.cumulativeScores }
      : Object.fromEntries(playerIds.map((p) => [p, 0])),
    stats: prevState ? prevState.stats : {},
    lastRoundScores: null,
    log: [],
    winnerId: null,
    declarerId: null,
    roundEndDetail: null,
    hasPlayedThisTurn: false,
    roundNumber: prevState ? (prevState.roundNumber || 1) + 1 : 1,
  };
  for (const pid of playerIds) {
    if (!(pid in game.cumulativeScores)) game.cumulativeScores[pid] = 0;
    if (!game.stats[pid]) game.stats[pid] = emptyStats();
    game.stats[pid].roundsPlayed += 1;
  }
  return game;
}

function advanceTurn(game) {
  const idx = game.playerIds.indexOf(game.currentTurnPlayerId);
  for (let i = 1; i <= game.playerIds.length; i++) {
    const next = (idx + i) % game.playerIds.length;
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
    game.drawPile = buildDeck();
    game.log.push({ t: Date.now(), msg: "Draw pile empty — fresh deck shuffled in." });
  }
}

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
  const discardCards = cardIds
    .map((id) => hand.find((c) => c.id === id))
    .filter(Boolean);
  if (discardCards.length !== cardIds.length)
    return { ok: false, error: "Card not in hand" };

  const v = validateDiscard(discardCards, game.rules);
  if (!v.ok) return v;

  // STEP 1: Draw from CURRENT pile state (i.e. previous player's discard)
  const drawSrc = action.draw && action.draw.source;
  let drawnCard = null;
  if (drawSrc === "deck") {
    reshuffleIfNeeded(game);
    drawnCard = game.drawPile.shift();
  } else if (drawSrc === "discard") {
    if (game.discardPile.length === 0)
      return { ok: false, error: "Discard pile is empty" };
    if (game.lastDiscardWasSequence && game.lastDiscardBy && game.lastDiscardBy !== playerId) {
      const wantedId = action.draw.cardId;
      const seqStart = game.discardPile.length - game.lastDiscardSize;
      const idx = game.discardPile.findIndex(
        (c, i) => i >= seqStart && c.id === wantedId,
      );
      if (idx === -1)
        return { ok: false, error: "Pick must be from the last discarded sequence" };
      drawnCard = game.discardPile.splice(idx, 1)[0];
      // sequence is broken — remaining cards stay but no longer act as "any pickup"
      game.lastDiscardWasSequence = false;
    } else {
      // Top card pickup
      drawnCard = game.discardPile.pop();
    }
  } else {
    return { ok: false, error: "Specify draw source" };
  }

  // STEP 2: Remove discarded cards from hand, add drawn card
  const discardSet = new Set(cardIds);
  game.hands[playerId] = hand.filter((c) => !discardSet.has(c.id));
  if (drawnCard) game.hands[playerId].push(drawnCard);

  // STEP 3: Push the new discard onto the pile
  for (const c of discardCards) game.discardPile.push(c);
  game.lastDiscardWasSequence = ["seq3", "seq4", "seq5"].includes(v.type) || v.type.startsWith("seq");
  game.lastDiscardSize = discardCards.length;
  game.lastDiscardBy = playerId;

  // Stats
  const st = game.stats[playerId];
  st.cardsDiscarded += discardCards.length;
  if (v.type.startsWith("seq")) st.sequencesPlayed++;
  if (v.type === "quad") st.quadsPlayed++;
  if (v.type === "pair") st.pairsPlayed++;

  game.hasPlayedThisTurn = true;
  const msg = `{you} discarded ${describeSet(discardCards, v.type)} and drew from ${
    drawSrc === "deck" ? "the deck" : "the discard pile"
  }.`;
  advanceTurn(game);
  return { ok: true, message: msg };
}

function describeSet(cards, type) {
  const names = cards.map(rankName).join(", ");
  const labels = {
    single: "a single",
    pair: "a pair",
    triplet: "a triplet",
    quad: "four-of-a-kind",
    seq3: "a 3-card sequence",
    seq4: "a 4-card sequence",
    seq5: "a 5-card sequence",
  };
  const label =
    labels[type] || (type.startsWith("seq") ? `a ${type.slice(3)}-card sequence` : type);
  return `${label} (${names})`;
}

function rankName(c) {
  const map = { 1: "A", 11: "J", 12: "Q", 13: "K" };
  return map[c.rank] || String(c.rank);
}

function doDeclare(game, playerId) {
  game.declarerId = playerId;
  game.stats[playerId].declarationsMade++;

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
  const penalty = game.rules.declarationPenalty;

  if (declarerTotal < minOther) {
    roundScores[playerId] = 0;
    for (const [pid, v] of others) roundScores[pid] = v;
    detail = { case: "declarerLowest" };
    game.stats[playerId].declarationsWon++;
  } else if (declarerTotal === minOther) {
    roundScores[playerId] = 0;
    for (const [pid, v] of others) roundScores[pid] = v;
    detail = { case: "tie", tiedWith: tiedWithDeclarer };
    game.stats[playerId].declarationsWon++;
  } else {
    roundScores[playerId] = penalty;
    const lowestPids = others.filter(([, v]) => v === minOther).map(([pid]) => pid);
    for (const [pid, v] of others) {
      roundScores[pid] = lowestPids.includes(pid) ? 0 : v;
    }
    detail = { case: "penalty", lowestPids, penalty };
    game.stats[playerId].declarationsFailed++;
  }

  // Track timesLowest stat (everyone with min hand value this round)
  const allTotals = Object.values(totals);
  const minOfAll = Math.min(...allTotals);
  for (const [pid, v] of Object.entries(totals)) {
    if (v === minOfAll) game.stats[pid].timesLowest++;
    if (v < game.stats[pid].bestHandTotal) game.stats[pid].bestHandTotal = v;
  }

  game.lastRoundScores = roundScores;
  game.roundEndDetail = detail;

  // Update cumulative & per-stat scores
  for (const [pid, s] of Object.entries(roundScores)) {
    game.cumulativeScores[pid] = (game.cumulativeScores[pid] || 0) + s;
    game.stats[pid].totalRoundScore += s;
  }

  // Elimination
  const newlyEliminated = [];
  if (game.mode === "setpoints") {
    for (const pid of Object.keys(roundScores)) {
      if (!game.eliminated.includes(pid) && game.cumulativeScores[pid] >= game.pointLimit) {
        game.eliminated.push(pid);
        newlyEliminated.push(pid);
      }
    }
  } else if (game.mode === "elimination") {
    let maxScore = -Infinity;
    for (const v of Object.values(roundScores)) if (v > maxScore) maxScore = v;
    for (const [pid, v] of Object.entries(roundScores)) {
      if (v === maxScore && !game.eliminated.includes(pid)) {
        game.eliminated.push(pid);
        newlyEliminated.push(pid);
      }
    }
  }
  detail.newlyEliminated = newlyEliminated;

  game.phase = "roundEnd";
  game.turnEndsAt = null;

  const remaining = game.playerIds.filter((p) => !game.eliminated.includes(p));
  if (remaining.length <= 1) {
    game.phase = "gameEnd";
    game.winnerId = remaining[0] || null;
  }

  return { ok: true, message: `{you} declared! Round ended.` };
}

export function randomValidAuto(game, playerId) {
  const hand = game.hands[playerId];
  if (hand.length === 0)
    return { type: "discard", cardIds: [], draw: { source: "deck" } };
  const sorted = hand.slice().sort((a, b) => cardValue(b) - cardValue(a));
  return { type: "discard", cardIds: [sorted[0].id], draw: { source: "deck" } };
}
