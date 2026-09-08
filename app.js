/* ============================================================
   Hadamard's Hoard — browser simulator
   Faithful digital adaptation of the IQC card/board game.
   See README.md for the design decisions behind the numbers.
   ============================================================ */

/* ---------- Board math ---------- */

// Rounded, dice-friendly boards mirroring the printed game boards.
// Each array lists the "measurable" tiles (as [numerator, denominator]).
// A guaranteed-win final tile is appended automatically.
const ROUNDED_BOARDS = {
  4:   [[1,4]],
  12:  [[1,12],[1,2]],
  30:  [[1,30],[1,4],[1,2],[5,6]],
  100: [[1,100],[1,10],[1,4],[2,5],[5,8],[4,5],[9,10]] // extrapolated — no printed board for N=100
};

function groverProbability(N, k){
  // Probability of success after k Grover iterations (0-indexed).
  const theta = Math.asin(1/Math.sqrt(N));
  return Math.pow(Math.sin((2*k+1)*theta), 2);
}

function buildBoard(N, mode){
  const roundedCount = ROUNDED_BOARDS[N].length;
  const tiles = [];
  for(let k=0;k<roundedCount;k++){
    if(mode === 'real'){
      tiles.push({ p: groverProbability(N,k), label: null });
    } else {
      const [num,den] = ROUNDED_BOARDS[N][k];
      tiles.push({ p: num/den, label: `${num}/${den}` });
    }
  }
  tiles.push({ p: 1, label: 'final', final: true });
  return tiles;
}

/* ---------- Event deck ---------- */

function freshEventDeck(){
  const cards = [];
  for(let i=0;i<8;i++) cards.push('DECOHERENCE');
  for(let i=0;i<4;i++) cards.push('COSMIC_RAY');
  for(let i=0;i<1;i++) cards.push('BLUE_SCREEN');
  for(let i=0;i<4;i++) cards.push('QEC');
  for(let i=0;i<7;i++) cards.push('EXTRA_RAM');
  return shuffle(cards);
}

const EVENT_TEXT = {
  DECOHERENCE: { title: 'Decoherence', desc: 'The right-most open tile is covered. Progress can\u2019t pass it until you next measure.' },
  COSMIC_RAY: { title: 'Cosmic Ray', desc: 'You must measure on your next turn.' },
  BLUE_SCREEN: { title: 'Blue Screen', desc: 'The dealer\u2019s entire deck is reshuffled from scratch (it keeps any Extra RAM).' },
  QEC: { title: 'Quantum Error Correction', desc: 'You gain a shield that cancels the next Decoherence drawn.' },
  EXTRA_RAM: { title: 'Extra RAM', desc: 'The dealer can now flip one additional card per turn.' }
};

/* ---------- Utilities ---------- */

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function freshClassicalDeck(N){
  const cards = [{type:'gem'}];
  for(let i=1;i<N;i++) cards.push({type:'blank'});
  return shuffle(cards);
}

/* ---------- Game state ---------- */

let game = null;

function newGame(config){
  game = {
    config,
    board: buildBoard(config.deckSize, config.probMode),
    quantum: {
      tileIndex: 0,
      maxReachable: buildBoard(config.deckSize, config.probMode).length - 1,
      points: 0,
      qecCharges: 0,
      forcedMeasure: false
    },
    classical: {
      deck: freshClassicalDeck(config.deckSize),
      revealed: 0,
      points: 0,
      ram: 0
    },
    eventDeck: config.eventsEnabled ? freshEventDeck() : [],
    phase: 'classical', // classical -> quantum -> event -> classical...
    over: false,
    log: []
  };
  render();
}

function finalIndex(){ return game.board.length - 1; }

function log(who, text){
  game.log.push({who, text});
  renderLog();
}

/* ---------- Turn logic: classical dealer ---------- */

function runClassicalTurn(){
  const c = game.classical;
  const draws = 1 + c.ram;
  let scored = false;

  for(let i=0;i<draws;i++){
    if(c.revealed >= c.deck.length) break; // safety
    const card = c.deck[c.revealed];
    c.revealed++;
    if(card.type === 'gem'){
      c.points++;
      log('c', `Dealer flips a gem! (${c.points}/${game.config.gemTarget})`);
      c.ram = 0; // discard held RAM when a point is scored
      c.deck = freshClassicalDeck(game.config.deckSize);
      c.revealed = 0;
      scored = true;
      break; // deck reset — remaining extra draws this turn are moot
    } else {
      log('c', `Dealer flips a blank (${c.revealed}/${c.deck.length}).`);
    }
  }

  render();
  if(checkWin()) return;
  game.phase = 'quantum';
  updateReadouts();
}

/* ---------- Turn logic: quantum player ---------- */

function canAdvance(){
  const q = game.quantum;
  return q.tileIndex < q.maxReachable;
}

function doAdvance(){
  if(game.phase !== 'quantum' || game.over) return;
  const q = game.quantum;
  if(q.forcedMeasure) return; // cosmic ray forces a measurement
  if(!canAdvance()) return;

  q.tileIndex++;
  if(q.tileIndex === finalIndex()){
    // Reaching the final tile counts as a measurement for interaction purposes,
    // but the gem itself waits for next turn's guaranteed collection.
    q.maxReachable = finalIndex();
    if(q.qecCharges > 0) q.qecCharges = 0; // used up on any measurement
    q.forcedMeasure = false;
    log('q', `You advance onto the final tile. The gem is guaranteed — collect it next turn.`);
  } else {
    log('q', `You run the algorithm. Now sitting at tile ${q.tileIndex+1}.`);
  }
  afterQuantumAction();
}

function doMeasure(){
  if(game.phase !== 'quantum' || game.over) return;
  const q = game.quantum;
  const tile = game.board[q.tileIndex];
  const success = Math.random() < tile.p;

  if(success){
    q.points++;
    log('q', `You measure… success! (${q.points}/${game.config.gemTarget})`);
  } else {
    log('q', `You measure… no luck this time.`);
  }

  // Any measurement: return to tile 1, clear decoherence, consume QEC, clear cosmic ray.
  q.tileIndex = 0;
  q.maxReachable = finalIndex();
  if(q.qecCharges > 0) q.qecCharges = 0;
  q.forcedMeasure = false;

  afterQuantumAction();
}

function afterQuantumAction(){
  render();
  if(checkWin()) return;
  if(game.config.eventsEnabled){
    game.phase = 'event';
    setTimeout(runEvent, 350);
  } else {
    game.phase = 'classical';
    updateReadouts();
    setTimeout(runClassicalTurn, 500);
  }
}

/* ---------- Turn logic: events ---------- */

function runEvent(){
  if(game.eventDeck.length === 0) game.eventDeck = freshEventDeck();
  const card = game.eventDeck.shift();
  const info = EVENT_TEXT[card];
  let text = `${info.title} — ${info.desc}`;

  const q = game.quantum;
  const c = game.classical;

  switch(card){
    case 'DECOHERENCE': {
      if(q.qecCharges > 0){
        q.qecCharges--;
        text = `Decoherence drawn, but your error correction shield cancels it.`;
      } else if(q.maxReachable > 0){
        q.maxReachable--;
        if(q.tileIndex > q.maxReachable) q.tileIndex = q.maxReachable;
        text = `${info.title} — tile ${q.maxReachable+2} is now covered. ${info.desc}`;
      } else {
        text = `${info.title} drawn, but every tile is already covered — no further effect.`;
      }
      break;
    }
    case 'COSMIC_RAY':
      q.forcedMeasure = true;
      break;
    case 'BLUE_SCREEN':
      c.deck = freshClassicalDeck(game.config.deckSize);
      c.revealed = 0;
      text = `${info.title} — the dealer's deck is wiped and reshuffled (RAM kept).`;
      break;
    case 'QEC':
      q.qecCharges++;
      break;
    case 'EXTRA_RAM':
      c.ram++;
      break;
  }

  log('e', text);
  showEventBanner(text);
  render();
  game.phase = 'classical';
  updateReadouts();
  setTimeout(runClassicalTurn, 900);
}

/* ---------- Win check ---------- */

function checkWin(){
  if(game.quantum.points >= game.config.gemTarget){
    endGame('quantum');
    return true;
  }
  if(game.classical.points >= game.config.gemTarget){
    endGame('classical');
    return true;
  }
  return false;
}

function endGame(winner){
  game.over = true;
  document.getElementById('win-icon').textContent = winner === 'quantum' ? '⚛️' : '🃏';
  document.getElementById('win-title').textContent = winner === 'quantum' ? 'You win!' : 'The dealer wins.';
  document.getElementById('win-sub').textContent = winner === 'quantum'
    ? 'Grover\u2019s algorithm found its target first.'
    : 'Classical search got lucky before you could measure it out.';
  showScreen('win-screen');
}

/* ---------- Rendering ---------- */

function render(){
  renderGems();
  renderQuantumBoard();
  renderClassicalDeck();
  renderIndicators();
  updateReadouts();
}

function renderGems(){
  const q = game.quantum, c = game.classical, target = game.config.gemTarget;
  document.getElementById('quantum-gems').innerHTML =
    Array.from({length: target}).map((_,i)=>`<span class="gem-slot ${i<q.points?'filled':''}">💎</span>`).join('');
  document.getElementById('classical-gems').innerHTML =
    Array.from({length: target}).map((_,i)=>`<span class="gem-slot ${i<c.points?'filled':''}">💎</span>`).join('');
}

function probToColor(p){
  // washed-out (low p) -> bright cyan (high p)
  const alpha = 0.15 + p*0.65;
  const light = 20 + p*35;
  return `hsla(190, 75%, ${light}%, ${alpha + 0.35})`;
}

function renderQuantumBoard(){
  const q = game.quantum;
  const wrap = document.getElementById('quantum-tiles');
  wrap.innerHTML = '';
  game.board.forEach((tile, idx)=>{
    const div = document.createElement('div');
    div.className = 'q-tile';
    if(idx === q.tileIndex) div.classList.add('current');
    if(idx > q.maxReachable) div.classList.add('blocked');
    if(tile.final) div.classList.add('final');

    if(tile.final){
      div.textContent = '💎';
    } else {
      const pct = Math.round(tile.p*100);
      if(game.config.showProb){
        div.textContent = game.config.probMode === 'rounded' ? tile.label : `${pct}%`;
        div.style.background = probToColor(tile.p);
      } else {
        div.style.background = probToColor(tile.p);
        div.textContent = '';
      }
    }
    wrap.appendChild(div);
  });
}

function renderClassicalDeck(){
  const c = game.classical;
  const wrap = document.getElementById('classical-deck');
  wrap.innerHTML = '';
  c.deck.forEach((card, idx)=>{
    const div = document.createElement('div');
    if(idx < c.revealed){
      div.className = `c-card ${card.type === 'gem' ? 'drawn-gem' : 'drawn-blank'}`;
      div.textContent = card.type === 'gem' ? '💎' : '·';
    } else {
      div.className = 'c-card';
      div.textContent = '';
    }
    wrap.appendChild(div);
  });
}

function renderIndicators(){
  const q = game.quantum, c = game.classical;

  const qecEl = document.getElementById('qec-shield');
  if(q.qecCharges > 0){
    qecEl.style.display = 'block';
    document.getElementById('qec-count').textContent = `×${q.qecCharges}`;
  } else {
    qecEl.style.display = 'none';
  }

  const ramEl = document.getElementById('ram-indicator');
  if(c.ram > 0){
    ramEl.style.display = 'block';
    document.getElementById('ram-count').textContent = c.ram;
    document.getElementById('ram-desc').textContent = `${1+c.ram} draws per turn`;
  } else {
    ramEl.style.display = 'none';
  }
}

function renderLog(){
  const wrap = document.getElementById('log-list');
  const cls = {q:'who-q', c:'who-c', e:'who-e'};
  const label = {q:'YOU', c:'DEALER', e:'EVENT'};
  wrap.innerHTML = game.log.slice(-40).map(entry =>
    `<div class="log-entry"><span class="${cls[entry.who]}">[${label[entry.who]}]</span> ${entry.text}</div>`
  ).reverse().join('');
}

function showEventBanner(text){
  const banner = document.getElementById('event-banner');
  banner.textContent = `⚡ ${text}`;
  banner.classList.add('show');
  clearTimeout(showEventBanner._t);
  showEventBanner._t = setTimeout(()=> banner.classList.remove('show'), 2600);
}

function updateReadouts(){
  const q = game.quantum, c = game.classical;
  const qEl = document.getElementById('quantum-readout');
  const cEl = document.getElementById('classical-readout');
  const advanceBtn = document.getElementById('advance-btn');
  const measureBtn = document.getElementById('measure-btn');
  const measureSub = document.getElementById('measure-sub');

  cEl.textContent = game.phase === 'classical'
    ? 'The dealer is searching…'
    : `Deck has ${c.deck.length - c.revealed} card(s) left before a reshuffle.`;

  const isQuantumTurn = game.phase === 'quantum' && !game.over;
  advanceBtn.disabled = !isQuantumTurn || q.forcedMeasure || !canAdvance();
  measureBtn.disabled = !isQuantumTurn;

  const tile = game.board[q.tileIndex];
  if(tile.final){
    measureSub.textContent = 'Guaranteed — no roll needed';
  } else if(game.config.showProb){
    measureSub.textContent = game.config.probMode === 'rounded'
      ? `Resolve at ${tile.label}`
      : `Resolve at ${Math.round(tile.p*100)}%`;
  } else {
    measureSub.textContent = 'Try your current odds';
  }

  if(!isQuantumTurn){
    qEl.textContent = game.phase === 'classical' ? 'Waiting for the dealer to draw…' : 'Resolving event…';
  } else if(q.forcedMeasure){
    qEl.innerHTML = `<span class="hl">Cosmic ray!</span> You must measure this turn.`;
  } else if(tile.final){
    qEl.innerHTML = `You're on the <span class="hl">final tile</span> — measure to collect your gem, guaranteed.`;
  } else {
    qEl.textContent = 'Advance the algorithm, or measure to try your luck.';
  }
}

/* ---------- Screens & setup ---------- */

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function readConfigFromSetup(){
  return {
    gemTarget: parseInt(document.getElementById('gem-target').value, 10),
    deckSize: parseInt(document.querySelector('#deck-size-group .pill.active').dataset.value, 10),
    probMode: document.querySelector('#prob-mode-group .pill.active').dataset.value,
    showProb: document.getElementById('show-prob-toggle').classList.contains('active'),
    eventsEnabled: document.getElementById('events-toggle').classList.contains('active')
  };
}

function wireSetupScreen(){
  document.querySelectorAll('.step-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const input = document.getElementById(btn.dataset.target);
      const step = parseInt(btn.dataset.step, 10);
      const min = parseInt(input.min,10), max = parseInt(input.max,10);
      input.value = Math.min(max, Math.max(min, parseInt(input.value,10) + step));
    });
  });

  document.querySelectorAll('#deck-size-group .pill').forEach(p=>{
    p.addEventListener('click', ()=>{
      document.querySelectorAll('#deck-size-group .pill').forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
    });
  });
  document.querySelectorAll('#prob-mode-group .pill').forEach(p=>{
    p.addEventListener('click', ()=>{
      document.querySelectorAll('#prob-mode-group .pill').forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
    });
  });
  ['show-prob-toggle','events-toggle'].forEach(id=>{
    const el = document.getElementById(id);
    el.addEventListener('click', ()=>{
      el.classList.toggle('active');
      el.setAttribute('aria-checked', el.classList.contains('active'));
    });
  });

  document.getElementById('start-btn').addEventListener('click', ()=>{
    const config = readConfigFromSetup();
    document.getElementById('deck-size-label').textContent = `N = ${config.deckSize}`;
    document.getElementById('target-label').textContent = `First to ${config.gemTarget}`;
    newGame(config);
    showScreen('game-screen');
    game.phase = 'classical';
    updateReadouts();
    setTimeout(runClassicalTurn, 400);
  });
}

function wireGameScreen(){
  document.getElementById('advance-btn').addEventListener('click', doAdvance);
  document.getElementById('measure-btn').addEventListener('click', doMeasure);
  document.getElementById('new-game-btn').addEventListener('click', ()=> showScreen('setup-screen'));
  document.getElementById('play-again-btn').addEventListener('click', ()=> showScreen('setup-screen'));
}

wireSetupScreen();
wireGameScreen();
