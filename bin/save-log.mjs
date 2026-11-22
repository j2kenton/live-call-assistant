#!/usr/bin/env node
// Log when Wispr Flow writes the live transcript to disk, to learn its save pattern.
//
//   node bin/save-log.mjs          run until live mode is switched off (live.mjs on starts it for you)
//   node bin/save-log.mjs show     print the end of the log
//
// Wispr shows speech in its window as it's said, but has been seen writing live.ndjson in batches,
// sometimes several minutes apart. Each line of the log is one write: when it happened, how many lines
// it added and from whom, how far behind speech the newest line was, and how long since the write before.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, SAVE_LOG, SAVE_LOG_PID, readState, transcriptDir } from './lib.mjs';

if (process.argv[2] === 'show') {
  try {
    const lines = fs.readFileSync(SAVE_LOG, 'utf8').trimEnd().split('\n');
    console.log(lines.slice(-60).join('\n'));
  } catch {
    console.log(`No save log yet (${SAVE_LOG}). It's written while live mode is on.`);
  }
  process.exit(0);
}

const root = transcriptDir();
if (!root) process.exit(0);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(SAVE_LOG_PID, String(process.pid));
const cleanup = () => { try { if (fs.readFileSync(SAVE_LOG_PID, 'utf8') === String(process.pid)) fs.rmSync(SAVE_LOG_PID); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const time = (ms) => new Date(ms).toTimeString().slice(0, 8);
const log = (line) => fs.appendFileSync(SAVE_LOG, `${line}\n`);

const newest = () => {
  let best = null;
  for (const n of fs.readdirSync(root)) {
    const f = path.join(root, n, 'live.ndjson');
    try {
      const s = fs.statSync(f);
      if (!best || s.mtimeMs > best.mtime) best = { f, id: n, mtime: s.mtimeMs, size: s.size };
    } catch {}
  }
  return best;
};

const entries = (f) => {
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    try {
      const o = JSON.parse(line);
      if (o.text && o.speaker) out.push(o);
    } catch {}
  }
  return out;
};

let cur = newest();
let count = cur ? entries(cur.f).length : 0;
let lastWrite = Date.now();
log(`# ${new Date().toISOString()} watching ${cur ? cur.id : '(no call yet)'}, ${count} lines so far`);

setInterval(() => {
  if (!readState()) {          // live mode switched off (or timed out): stop
    log(`# ${new Date().toISOString()} live mode off, stopped`);
    process.exit(0);
  }
  const now = newest();
  if (!now) return;
  if (!cur || now.f !== cur.f) {
    cur = now;
    count = entries(now.f).length;
    lastWrite = Date.now();
    log(`# ${new Date().toISOString()} new call ${now.id}, ${count} lines so far`);
    return;
  }
  if (now.size === cur.size) return;
  const all = entries(now.f);
  const fresh = all.slice(count);
  const t = Date.now();
  const by = {};
  for (const o of fresh) {
    const who = o.speaker.source === 'mic' ? 'mic' : 'system';
    by[who] = (by[who] || 0) + 1;
  }
  const end = Math.max(0, ...fresh.map((o) => o.endEpochMs || o.startEpochMs || 0));
  const behind = end ? `newest line ends ${time(end)}, ${Math.round((t - end) / 1000)}s behind` : 'no new lines';
  const who = Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
  log(`${time(t)}  +${fresh.length} lines (${who})  ${behind}  ${Math.round((t - lastWrite) / 1000)}s since last write`);
  cur = now;
  count = all.length;
  lastWrite = t;
}, 1000);
