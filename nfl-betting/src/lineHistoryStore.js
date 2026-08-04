import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const NFL_FILE = path.join(CACHE_DIR, 'line-history-nfl.json');
const CFB_FILE = path.join(CACHE_DIR, 'line-history-cfb.json');

async function load(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

async function save(file, history) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(history, null, 2));
}

export const loadNflLineHistory = () => load(NFL_FILE);
export const saveNflLineHistory = (history) => save(NFL_FILE, history);
export const loadCfbLineHistory = () => load(CFB_FILE);
export const saveCfbLineHistory = (history) => save(CFB_FILE, history);
