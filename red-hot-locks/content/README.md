# Red Hot Locks — social content pipeline

Daily TikTok/X video content, built from the same real research the picks
board uses. No copyrighted footage, no fabricated conviction.

## Why motion graphics, not real highlight clips

Player highlights and broadcast footage (NFL/CFB/network broadcasts) are
copyrighted. Using them in monetized promotional content without a license
is infringement — the realistic outcome is takedowns and, on repeat strikes,
the account getting banned, which is a much worse outcome for a paid
business than "the video isn't using real game footage." Motion graphics
built from real data (odds, matchups, the actual line) sidestep that
entirely and, done well, read as more credible anyway — the whole brand
pitch is "we show our work," and stat-driven visuals *are* the work.

If you want real footage later, license stock sports b-roll from a service
that actually sells usage rights (this is a real cost/step, not something to
skip) rather than pulling clips from broadcasts or other creators.

## Daily workflow

1. `video-template/template.html` is the reusable animation shell — 5 scenes,
   ~27s, autoplays on load. `build.mjs` inlines fonts into a standalone file.
2. For each new video: duplicate the template, edit the scene content
   (matchup, odds, insight, CTA) to that day's real data — pull it from the
   same sources the picks board uses (WebSearch for odds/injuries/news, the
   `nfl-betting` engine for the actual pick once real games are live).
3. Write the matching script in `scripts/YYYY-MM-DD-slug.md` (see the
   existing file for the format: timed voiceover table, caption, hashtags).
4. Record: screen-record the template autoplaying, add voiceover (your own
   voice or a TTS tool — nothing here generates audio), edit + caption in
   CapCut/Descript/whatever you use, post.

## What's NOT automated here

Nothing posts to TikTok or X automatically — there's no social posting API
connected in this environment (checked; only a finance-data connector is
available). This pipeline produces the video template and script; a human
still records the voiceover and hits publish. If you want to look into
proper API-based scheduling later, TikTok's Content Posting API requires
business/developer approval, and X's API requires a paid tier for posting.
