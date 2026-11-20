// Shared paths and settings for live-call-assistant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = path.dirname(fileURLToPath(import.meta.url));
export const HOME = path.resolve(BIN, '..');

// Per-user data lives outside the repo, so nothing personal is ever committed.
export const DATA_DIR = process.env.LCA_DATA_DIR || path.join(os.homedir(), '.live-call-assistant');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  wisprDir: null,          // auto-detected when null
  settleSeconds: 4,        // a speaker pause this long ends a chunk of new speech
  maxAgeHours: 4,          // live mode switches itself off after this long
  shortMessageChars: 60,   // messages up to this length count as "help me now"
  youLabel: 'You',         // label for your microphone
  themLabel: 'Them',       // label for the other side of the call
};

export function config() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  const c = { ...DEFAULTS, ...user };
  if (process.env.LCA_WISPR_DIR) c.wisprDir = process.env.LCA_WISPR_DIR;
  return c;
}

// Where Wispr Flow keeps meeting transcripts. Windows is tested; the macOS path is a best guess.
export function wisprCandidates() {
  const c = config();
  if (c.wisprDir) return [c.wisprDir];
  const list = [];
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'Wispr Flow', 'meetings'));
  list.push(path.join(os.homedir(), 'Library', 'Application Support', 'Wispr Flow', 'meetings'));
  list.push(path.join(os.homedir(), '.config', 'Wispr Flow', 'meetings'));
  return list;
}

export function wisprDir() {
  return wisprCandidates().find((d) => fs.existsSync(d)) || null;
}

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const ageH = (Date.now() - new Date(s.startedAt).getTime()) / 3.6e6;
    if (!(ageH < config().maxAgeHours)) {
      fs.rmSync(STATE_FILE, { force: true });
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function writeState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export function clearState() {
  fs.rmSync(STATE_FILE, { force: true });
}

// Forward slashes work in every shell Claude Code uses, including on Windows.
export const q = (p) => `"${p.replace(/\\/g, '/')}"`;
