# Red Hot Locks — the board (public Artifact source)

Source for the free public board (previously only lived in an ephemeral
scratch directory — now tracked here so a container restart can't lose it).

```bash
node build.mjs   # inlines fonts (Erica One / Outfit / Red Hat Mono), writes nfl-edge.html
```

Publish `nfl-edge.html` as a Claude Artifact (or wherever it's hosted).

## Structure

Five pages behind a CSS-only radio-button tab switcher (no framework):

- **NFL Futures** — transaction wire, Super Bowl rail, MVP rail, Offensive/Defensive
  Rookie of the Year + stat-leader awards grid, futures value board, all-8 division grid
- **NFL Props** — empty state until real prop menus post (Preseason Week 1, Aug 13+)
- **NFL Picks** — spread-first weekly game picks
- **CFB Futures** — coaching/portal wire, CFP rail, futures value board, all-9-conference
  championship-race grid (Power 4 + every Group of 5 conference — AAC, Mountain West,
  Conference USA, MAC, Sun Belt)
- **CFB Picks** — spread-first weekly game picks

A shared hero + Track Record strip sit above the tabs; shared methodology/legal
sits below. `.cfb-theme` on the two CFB panels swaps the accent color
(orange/violet) instead of duplicating CSS per panel.

## Team badges & player avatars — not official logos or photos

Official team logos and player photos are trademarked/copyrighted assets we
don't have rights to use. `.team-badge` is a colored monogram chip using
each team's real (public) brand color — not a logo image. `.player-avatar`
is a generic jersey-silhouette icon. Both are driven by `data-team="XXX"` /
`data-player="..."` attributes; the `TEAM_META` color map and badge injector
live in the `<script>` block at the end of `template.html`.

## Line shopping (best odds / best EV)

Every committed pick shows the best price across six books (DraftKings,
Fanatics, FanDuel, BetMGM, BetRivers, Bet365) via the `.book-shop` component,
sourced from `nfl-betting/src/analysis/valueFinder.js`'s `bookComparison`
field. The best-odds book and the best-EV book are always the same book for
a fixed model probability — that's expected math, not a UI bug, and the
methodology section says so explicitly.

## Click-to-compare (tap a pick's odds)

Every pick's `.spread-block` is clickable (`role="button"`, keyboard-accessible)
and toggles an adjacent `.book-compare` panel showing the per-book breakdown
for that exact line — this is the interaction, not just the `.book-shop`
best-price summary. Wiring: `data-compare="some-id"` on the trigger,
`id="some-id"` on the `.book-compare` panel, toggled by the click-to-compare
JS block (searches for `[data-compare]`).

**Data honesty note**: WebSearch can summarize odds articles but can't
reliably pull distinct per-book prices for lower-profile games — the actual
odds-comparison sites (SportsBettingDime, VegasInsider, etc.) block
WebFetch. Where only one or two books' numbers are independently confirmed,
say so explicitly in the panel rather than inventing plausible-looking
numbers for the rest — see the Hall of Fame Game example in the current
build. This resolves for real once a live odds feed
(`ODDS_API_KEY` → `nfl-betting/src/providers/oddsProvider.js`) is connected;
the `bookComparison` field that powers this UI already works end-to-end in
mock mode (tested in `nfl-betting/test/valueFinder.test.js`).

## Animation system

Reveal-on-scroll (IntersectionObserver, one-time), spring-eased hover lift
on cards, count-up numbers for the Track Record tiles, a one-time hero
shimmer, and a football-flyby transition on page-tab changes. Everything
respects `prefers-reduced-motion` — check the CSS media query and the `reduceMotion`
JS flag before adding new motion.

## Position matchups (Next Gen Stats)

Game-pick matchup notes can include a Next Gen Stats-derived edge
("skill-position tracking data grades above average vs. this defense") —
sourced from `nfl-betting/src/analysis/positionMatchup.js`, which blends a
team's real NGS receiving/rushing numbers across recent seasons (recency-weighted,
most recent season counted highest) into a mismatch ratio against the
opponent. Wired into `matchupEngine.js` as the optional `ngsEdges` param, so
it never breaks a projection that doesn't supply it. **Scope limit that must
stay documented wherever this appears**: there's no free public
defensive-player tracking data, so this only measures offensive skill-position
strength/trend — not a real two-sided "these receivers vs. that specific
cornerback" matchup.

## Data sourcing standard for pick reasoning

Every pick card's `.reasoning` text (and the CFB/NFL matchup notes generally)
must be grounded in one of two legitimate tiers — never invented certainty:

1. **Model math** — always safe to state plainly, it's genuinely computed:
   power-rating differential, `matchupEngine.js`'s projected spread/total,
   `schemeTendencies.js`'s pass-rush/pace mismatch notes, `weatherImpact.js`'s
   notes, and `positionMatchup.js`'s Next Gen Stats position-group edge.
2. **Cited research** — WebSearch results, named by source inline, only when
   that source actually returned the claim this run.

Confirmed by direct testing (Aug 2026): CFB Graphs, CFBDepth, PEARatings,
RotoWire's tool pages, Tracking Football, CFBstats, and DraftEdge all return
HTTP 403 to WebFetch on every page tested, including specific articles —
bot-protection, not a missing API key. Don't retry WebFetch on sites like
these. WebSearch scoped to those domains can still surface useful headline
snippets — cite them by name when genuinely returned, never fabricate a
stat table or matchup grade attributed to one of these sites.

## Mascot

`#chili-mascot` is an SVG `<symbol>` defined once and reused via `<use>` for
both the small nav mark and the large hero illustration, plus a standalone
`#chili-football` symbol for the tab-transition flyby element.
