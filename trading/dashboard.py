#!/usr/bin/env python3
"""Generates the trading dashboard HTML from journal.json + latest_scan.json.
Run after each scan cycle, then publish trading/dashboard.html as an Artifact.
"""
import json
import os
from datetime import datetime, timezone

import journal

HERE = os.path.dirname(__file__)
SCAN_PATH = os.path.join(HERE, "data", "latest_scan.json")
OUT_PATH = os.path.join(HERE, "dashboard.html")


def load_scan():
    if not os.path.exists(SCAN_PATH):
        return {"timestamp": None, "candidates": []}
    with open(SCAN_PATH) as f:
        return json.load(f)


def fmt_pct(v, signed=True):
    if v is None:
        return "—"
    sign = "+" if signed and v > 0 else ""
    return f"{sign}{v:.2f}%"


def fmt_price(v):
    if v is None:
        return "—"
    if v >= 1:
        return f"${v:,.4f}".rstrip("0").rstrip(".")
    return f"${v:.8f}".rstrip("0").rstrip(".")


def render():
    s = journal.stats()
    scan = load_scan()
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def open_row(t):
        return f"""<tr>
          <td class="sym">{t['symbol']}</td>
          <td class="num">{fmt_price(t['entry_price'])}</td>
          <td class="num">{fmt_price(t['stop_loss_price'])}</td>
          <td class="num">{fmt_price(t['take_profit_price'])}</td>
          <td class="num">{t['consensus_score']:.1f}</td>
          <td class="tfs">{', '.join(k for k,v in t['rel_vol_by_tf'].items() if v and v>=2)}</td>
          <td class="muted">{t['entry_time'][:16].replace('T',' ')}</td>
        </tr>"""

    def closed_row(t):
        win = t["pnl_pct"] is not None and t["pnl_pct"] > 0
        badge_cls = "good" if win else "critical"
        badge_txt = "WIN" if win else "LOSS"
        return f"""<tr>
          <td class="sym">{t['symbol']}</td>
          <td><span class="badge {badge_cls}">{badge_txt}</span></td>
          <td class="num">{fmt_price(t['entry_price'])}</td>
          <td class="num">{fmt_price(t['exit_price'])}</td>
          <td class="num {'good' if win else 'critical'}">{fmt_pct(t['pnl_pct'])}</td>
          <td class="muted">{t['exit_reason']}</td>
          <td class="muted">{(t['exit_time'] or '')[:16].replace('T',' ')}</td>
        </tr>"""

    def candidate_row(c):
        return f"""<tr>
          <td class="sym">{c['symbol']}</td>
          <td class="num">{c.get('consensus_score', 0):.1f}</td>
          <td class="tfs">{', '.join(c.get('strong_tfs', []))}</td>
          <td class="muted">{c.get('note','')}</td>
        </tr>"""

    open_rows = "".join(open_row(t) for t in s["open_trades"]) or \
        '<tr><td colspan="7" class="empty">No open positions</td></tr>'
    closed_rows = "".join(closed_row(t) for t in s["closed_trades"][:30]) or \
        '<tr><td colspan="7" class="empty">No closed trades yet</td></tr>'
    candidate_rows = "".join(candidate_row(c) for c in scan.get("candidates", [])) or \
        '<tr><td colspan="4" class="empty">No candidates from the latest scan</td></tr>'

    win_rate = fmt_pct(s["win_rate_pct"], signed=False) if s["win_rate_pct"] is not None else "—"
    avg_pnl = fmt_pct(s["avg_pnl_pct"])

    html = f"""<title>Crypto Rel-Vol Swing Tracker</title>
<style>
  .viz-root {{
    color-scheme: light;
    --surface-1: #fcfcfb; --page: #f9f9f7;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781;
    --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
    --good: #0ca30c; --critical: #d03b3b; --good-text: #006300;
    --blue: #2a78d6;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--page); color: var(--text-primary);
    min-height: 100vh; padding: 24px 16px 48px;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:where(:not([data-theme="light"])) .viz-root {{
      color-scheme: dark;
      --surface-1: #1a1a19; --page: #0d0d0d;
      --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #898781;
      --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
      --good: #0ca30c; --critical: #e66767; --good-text: #0ca30c;
      --blue: #3987e5;
    }}
  }}
  :root[data-theme="dark"] .viz-root {{
    color-scheme: dark;
    --surface-1: #1a1a19; --page: #0d0d0d;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #898781;
    --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
    --good: #0ca30c; --critical: #e66767; --good-text: #0ca30c;
    --blue: #3987e5;
  }}
  .wrap {{ max-width: 980px; margin: 0 auto; }}
  h1 {{ font-size: 20px; margin: 0 0 2px; }}
  .subtitle {{ color: var(--text-secondary); font-size: 13px; margin-bottom: 20px; }}
  .tiles {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 28px; }}
  .tile {{
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px;
  }}
  .tile .label {{ font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }}
  .tile .value {{ font-size: 26px; font-variant-numeric: tabular-nums; }}
  section {{ margin-bottom: 28px; }}
  h2 {{ font-size: 14px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 10px; }}
  table {{ width: 100%; border-collapse: collapse; background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }}
  th {{ text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 500; padding: 10px 12px; border-bottom: 1px solid var(--grid); }}
  td {{ padding: 10px 12px; border-bottom: 1px solid var(--grid); font-size: 13px; }}
  tr:last-child td {{ border-bottom: none; }}
  .num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .sym {{ font-weight: 600; }}
  .muted {{ color: var(--text-muted); font-size: 12px; }}
  .tfs {{ color: var(--blue); font-size: 12px; font-variant-numeric: tabular-nums; }}
  .good {{ color: var(--good-text); }}
  .critical {{ color: var(--critical); }}
  .badge {{ font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }}
  .badge.good {{ background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--good-text); }}
  .badge.critical {{ background: color-mix(in srgb, var(--critical) 18%, transparent); color: var(--critical); }}
  .empty {{ text-align: center; color: var(--text-muted); padding: 20px; }}
  .overflow {{ overflow-x: auto; border-radius: 10px; }}
  .overflow table {{ border-radius: 0; }}
</style>
<div class="viz-root">
  <div class="wrap">
    <h1>Crypto Relative-Volume Swing Tracker</h1>
    <div class="subtitle">Paper-trading journal &middot; last scan: {scan.get('timestamp') or 'never'} &middot; page generated {generated_at}</div>

    <div class="tiles">
      <div class="tile"><div class="label">Win rate</div><div class="value">{win_rate}</div></div>
      <div class="tile"><div class="label">Closed trades</div><div class="value">{s['closed_count']}</div></div>
      <div class="tile"><div class="label">Avg P/L per trade</div><div class="value">{avg_pnl}</div></div>
      <div class="tile"><div class="label">Open positions</div><div class="value">{s['open_count']}</div></div>
    </div>

    <section>
      <h2>Open positions</h2>
      <div class="overflow"><table>
        <thead><tr><th>Symbol</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Target</th><th class="num">Score</th><th>Elevated TFs</th><th>Opened</th></tr></thead>
        <tbody>{open_rows}</tbody>
      </table></div>
    </section>

    <section>
      <h2>Closed trades</h2>
      <div class="overflow"><table>
        <thead><tr><th>Symbol</th><th>Result</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">P/L</th><th>Reason</th><th>Closed</th></tr></thead>
        <tbody>{closed_rows}</tbody>
      </table></div>
    </section>

    <section>
      <h2>Latest scan &mdash; candidates not yet entered</h2>
      <div class="overflow"><table>
        <thead><tr><th>Symbol</th><th class="num">Score</th><th>Elevated TFs</th><th>Note</th></tr></thead>
        <tbody>{candidate_rows}</tbody>
      </table></div>
    </section>
  </div>
</div>
"""
    with open(OUT_PATH, "w") as f:
        f.write(html)
    return OUT_PATH


if __name__ == "__main__":
    print(render())
