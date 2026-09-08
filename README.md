# Hadamard's Hoard — Browser Simulator

A single-player digital adaptation of *Hadamard's Hoard*, the quantum-search
card/board game from the University of Waterloo's Institute for Quantum
Computing (IQC Scientific Outreach). You always play the **quantum search**;
the **classical search** is an automated dealer.

Live rules reference: the original game's facilitator instructions, turn
order, and probability table are in `Quantum-Search-Game-Boards-Pieces-v4.pdf`.

## Running it

This is a static site — no build step, no dependencies.

- **Locally**: open `index.html` in a browser, or run a tiny local server
  (`python3 -m http.server`) and visit it.
- **GitHub Pages**: push this folder to a repo, then in
  **Settings → Pages**, set the source to the branch/root containing these
  files. No workflow file needed.

## What's configurable at setup

| Setting | Options | Default |
|---|---|---|
| Gems to win | 1–10 | 3 |
| Database size (N) | 4, 12, 30, 100 | 12 |
| Probability model | Rounded (dice-friendly) / Real Grover formula | Rounded |
| Show probabilities on tiles | On/Off | On |
| Event cards | On/Off | On |

## Design decisions & assumptions (please sanity-check these)

The source PDF specifies exact printed boards for N = 4, 12, and 30, and a
probability table that includes N = 100 but no printed board for it. To keep
a consistent "discrete tile, no overshoot" board for every size:

- **N = 100 board** is my own extrapolation, not in the source material. It
  rounds the table's values through the peak (1%, 9%, 23%, 42%, 62%, 80%,
  93%) to friendly fractions (1/100, 1/10, 1/4, 2/5, 5/8, 4/5, 9/10), then a
  guaranteed final tile — following the same pattern the printed N=30 board
  uses (stop at the tile just before the peak, make the peak itself free).
- **"Real Grover formula" mode** keeps the *same number of tiles* as the
  rounded board (so Decoherence/board mechanics still make sense) but computes
  each measurable tile's actual probability with
  `P(k) = sin²((2k+1)·asin(1/√N))` instead of using a rounded dice fraction.
  The final tile is still a guaranteed win in both modes, matching the
  printed rule ("if the arrow points to the final tile, you may measure to
  collect a point without rolling any dice") — this intentionally does not
  model Grover overshoot (see below).
- **Overshoot is not modelled.** The physical boards never let the quantum
  player rotate past the peak probability, so the digital board doesn't
  either, even in "real" mode. If you'd like a variant where over-rotating
  past the optimal iteration count actually reduces your odds (as true
  Grover's algorithm does — see the N=100 row in the source PDF's table,
  where iteration 8 drops back to 98%), that would need a different, non-tile
  based board and would interact awkwardly with Decoherence as written. Flag
  if you want that explored as a separate mode.
- **Event card counts.** The PDF shows cropped example cards (8 Decoherence,
  4 Cosmic Ray, 1 Blue Screen, 4 Quantum Error Correction, and a partial view
  of Extra RAM) totaling 23 visible against a stated deck of 24. I filled the
  gap with 7 Extra RAM cards to reach 24. Adjust `freshEventDeck()` in
  `app.js` if you have the exact printed counts.
- **Holding cards is automated per your instructions**: Quantum Error
  Correction and Extra RAM apply immediately when drawn rather than being
  held and played later.
  - QEC arms a shield that cancels the *next* Decoherence draw only; it
    cannot retroactively remove a Decoherence already in play. It's also
    discarded (used up) the moment you make any measurement, whether or not
    it ever cancelled anything.
  - Extra RAM stacks; each copy gives the dealer one more card flip per
    turn. All held RAM is discarded when the dealer scores a point (not when
    a full deck cycle passes without scoring).
- **Decoherence stacking**: each new Decoherence card covers the next
  right-most *still-open* tile (progressively squeezing the ceiling toward
  tile 1). If the arrow is sitting on the tile that just became covered, it's
  bumped back one tile immediately. Any measurement (successful or not, and
  including "arriving at the final tile" per the printed rule) clears every
  active Decoherence at once, per your instruction.
- **Multiple database sizes** are offered as independent one-off games
  (pick a size, play to the gem target, done) rather than the physical
  game's forced 4 → 12 → 30 progression — per your note that the
  progression was for pedagogical framing only.

## File overview

- `index.html` — setup screen, game screen, win screen.
- `style.css` — visual design (dark lab theme; cyan/violet for the quantum
  panel, brass/amber for the classical panel).
- `app.js` — all game state and logic: board construction, event deck,
  classical dealer automation, quantum turn resolution, rendering.

## Possible follow-ups not yet built

- A true "overshoot-enabled" continuous-probability mode (see above).
- Letting the player hold and manually time Extra RAM / QEC instead of
  auto-applying them.
- A "stage progression" mode that chains N=4 → 12 → 30 automatically for
  the pedagogical framing described in the original rules.
