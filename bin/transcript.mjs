#!/usr/bin/env node
// Read the live transcript of the call in progress (from Wispr Flow's local files).
//
//   node bin/transcript.mjs [seconds]
//       Print the last N seconds (default 300), then "# cursor N".
//
//   node bin/transcript.mjs --wait [maxSeconds] --after N [--min S]
//       Wait for speech after line N (the cursor the previous call printed), and print it once the
//       speaker pauses, with the line before it for context, then the new cursor. Gives up after
//       maxSeconds (default 120). --min S keeps collecting for at least S seconds first, which suits
//       "suggest something now and then" modes on busy calls. Always pass --after, so lines that land
//       between two calls are never missed.
//
// Wispr writes each meeting to <meetings>/<id>/live.ndjson while the call runs, a few seconds behind
// speech. "mic" lines are you; "system" lines are everyone else on the call.
import fs from 'node:fs';
import path from 'node:path';
import { config, wisprCandidates, wisprDir } from './lib.mjs';

const cfg = config();
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : null;
};
const waitMode = args[0] === '--wait';
const after = flag('--after');
const minSeconds = flag('--min') || 0;
const num = args.find((a, i) => /^\d+$/.test(a) && !['--after', '--min'].includes(args[i - 1]));
const seconds = Number(num || (waitMode ? 120 : 300));
const SETTLE_MS = cfg.settleSeconds * 1000;

const root = wisprDir();
if (!root) {
  console.log(`NO_WISPR: no Wispr Flow meetings folder found. Looked in:\n${wisprCandidates().join('\n')}\n` +
    'Set "wisprDir" in ~/.live-call-assistant/config.json if yours is elsewhere.');
  process.exit(2);
}

const newest = () => fs.readdirSync(root)
  .map((n) => path.join(root, n, 'live.ndjson'))
  .filter((f) => fs.existsSync(f))
  .map((f) => ({ f, ...(({ mtimeMs, size }) => ({ mtime: mtimeMs, size }))(fs.statSync(f)) }))
  .sort((a, b) => b.mtime - a.mtime)[0];

const entries = (f) => {
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.text && o.speaker) out.push(o);
  }
  return out;
};

const time = (ms) => new Date(ms).toTimeString().slice(0, 8);
const render = (list) => {
  let last = null;
  const out = [];
  for (const o of list) {
    const who = o.speaker.source === 'mic' ? cfg.youLabel : (o.speaker.name || cfg.themLabel);
    const text = o.text.trim();
    if (last && last.who === who) last.text += ' ' + text;
    else out.push((last = { at: o.startEpochMs, who, text }));
  }
  return out.map((e) => `[${time(e.at)}] ${e.who}: ${e.text}`).join('\n');
};

const start = newest();
if (!start) {
  console.log('NO_TRANSCRIPT: Wispr has no meeting transcripts yet. Is it recording this call?');
  process.exit(2);
}
const inProgress = !fs.existsSync(path.join(path.dirname(start.f), 'refined.ndjson'));
const ageS = Math.round((Date.now() - start.mtime) / 1000);

if (!waitMode) {
  console.log(`# call ${inProgress ? 'in progress' : 'FINISHED'}, last written ${ageS}s ago` +
    (inProgress ? '' : ' (WARNING: the latest call has ended; is Wispr recording the current one?)'));
  const since = Date.now() - seconds * 1000;
  const all = entries(start.f);
  const recent = all.filter((o) => (o.endEpochMs || o.startEpochMs || 0) >= since);
  console.log(recent.length ? render(recent) : `[nothing said in the last ${seconds}s]`);
  console.log(`# cursor ${all.length}`);
  process.exit(0);
}

const initial = entries(start.f).length;
const baseCount = after != null && after <= initial ? after : initial;
const t0 = Date.now();
let lastSize = start.size;
let lastChange = 0;
const timer = setInterval(() => {
  const cur = newest();
  if (!cur) return;
  if (cur.f !== start.f || cur.size < lastSize) {
    clearInterval(timer);
    console.log('[the call changed or ended while waiting]');
    process.exit(0);
  }
  const now = Date.now();
  if (cur.size !== lastSize) { lastSize = cur.size; lastChange = now; }
  const all = entries(cur.f);
  const fresh = all.slice(baseCount);
  const settled = now - Math.max(lastChange, start.mtime) >= SETTLE_MS;
  const report = (label) => {
    clearInterval(timer);
    const ctx = baseCount > 0 ? `(before) ${render(all.slice(baseCount - 1, baseCount))}\n` : '';
    console.log(`# ${label}\n${ctx}${render(fresh)}\n# cursor ${all.length}`);
    process.exit(0);
  };
  if (fresh.length && settled && now - t0 >= minSeconds * 1000) {
    report(`new speech (waited ${Math.round((now - t0) / 1000)}s)`);
  }
  if (now - t0 >= seconds * 1000) {
    if (fresh.length) report(`new speech (still going after ${seconds}s)`);
    clearInterval(timer);
    console.log(`[nothing new in ${seconds}s]\n# cursor ${all.length}`);
    process.exit(0);
  }
}, 1000);
