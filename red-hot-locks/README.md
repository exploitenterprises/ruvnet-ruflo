# Red Hot Locks — the business layer

This directory is the commercial product built on top of the `nfl-betting/`
analytics engine: a sales website (`site/`) that sells access to the weekly
picks. `nfl-betting/` stays the free public engine/board; this is what turns
it into a paid product.

The TikTok/X video content pipeline that used to live here has been scrapped
(the effort's going into the free board's live injury tracking and the
site's presentation instead). Injury monitoring is handled by the
`nfl-betting` Tue/Thu/Sat Routine, not by anything in this directory.

## What's here

- **`site/`** — the sales website source (`template.html` + `build.mjs`,
  same pattern as `nfl-betting`'s artifact build: `node build.mjs` inlines
  fonts and writes the final HTML). Pricing tiers, track record, FAQ, and
  legal/responsible-gambling copy. See `site/README.md` before launch.

## Before this touches real money

1. **Payments**: `site/template.html` has a `STRIPE_PAYMENT_LINKS` config
   block — create Products + Payment Links in your own Stripe Dashboard and
   paste the URLs in. Until then the site shows an honest "checkout coming
   soon" notice instead of a dead button.
2. **Pick delivery**: a static site can't gate content. Decide how buyers
   actually receive picks after paying (email list, private Discord, a
   member-gated page) before selling anything — the FAQ currently says
   delivery details land on the receipt, which needs to be true.
3. **Legal review**: the Terms/Privacy/Refund/Responsible-Gambling copy on
   the site is solid starter language, not legal advice. Sports-picks sales
   intersect gambling-adjacent advertising rules that vary by state/country
   — get it reviewed before charging real customers.
