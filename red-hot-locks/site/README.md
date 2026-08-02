# Red Hot Locks — sales site

```bash
node build.mjs   # inlines fonts (IBM Plex Serif / Outfit / Red Hat Mono), writes redhotlocks-site.html
```

Publish `redhotlocks-site.html` wherever you host it (or as a Claude Artifact
during development). It's a static single-page site — no backend.

## Wiring up checkout

Open `template.html`, find `STRIPE_PAYMENT_LINKS` near the bottom, and fill
in the four Stripe Payment Link URLs (create these in your Stripe Dashboard:
Product Catalog → add a product per tier → Payment Links). No backend code
needed — Stripe hosts the actual checkout page. Set each Payment Link's
post-purchase redirect to wherever buyers should land next.

## What still needs a real decision before launch

- **Pick delivery**: how do buyers actually receive picks after paying?
  (Email list via Mailchimp/ConvertKit, a private Discord invite, a
  member-gated page.) The FAQ answer on the site currently says details
  "land on your receipt" — make that true before selling anything.
- **Legal copy**: the Responsible Gambling / Terms / Privacy sections are
  reasonable starting language, not a substitute for actual legal review.
  Sports-picks businesses intersect gambling-adjacent ad rules that vary by
  state and platform (Stripe itself restricts some gambling-adjacent
  categories — read their acceptable-use policy for "sports forecasting/
  picks services" before assuming your account won't get flagged).
- **Track record numbers**: pulled from the same
  `nfl-betting/data/picks-ledger.json` the free board uses — keep them in
  sync, don't hand-edit the site's numbers separately.
