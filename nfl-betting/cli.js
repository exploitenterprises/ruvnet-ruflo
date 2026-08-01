#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWeeklyUpdate } from './src/weeklyUpdate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; } else { args[key] = true; }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
NFL Betting Strategy Engine

USAGE:
  node cli.js update --week <n> [--season <yyyy>] [--source mock|live]
  node cli.js help

EXAMPLES:
  node cli.js update --week 1 --source mock     # fully offline demo run
  node cli.js update --week 3 --season 2026 --source live   # needs network + ODDS_API_KEY

Reports are written to reports/week-<n>-<season>.md and .json
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? 'help';

  if (command === 'help' || args.help) return printHelp();

  if (command === 'update') {
    const season = Number(args.season ?? new Date().getFullYear());
    const week = Number(args.week ?? 1);
    const source = args.source ?? 'mock';

    console.log(`Running weekly update: season=${season} week=${week} source=${source}`);
    const result = await runWeeklyUpdate({ season, week, source });

    const reportsDir = path.join(__dirname, 'reports');
    await mkdir(reportsDir, { recursive: true });
    const base = `week-${week}-${season}`;
    await writeFile(path.join(reportsDir, `${base}.md`), result.markdown);
    await writeFile(path.join(reportsDir, `${base}.json`), JSON.stringify(result, null, 2));

    console.log(`\n${result.projections.length} games projected, ${result.valueBets.length} value bets found, ${result.futuresValue.length} futures edges found.`);
    console.log(`Report written to reports/${base}.md`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exitCode = 1;
});
