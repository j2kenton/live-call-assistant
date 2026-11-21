#!/usr/bin/env node
// Live transcripts from an Android phone's own call recordings (docs/phone.md).
//
//   node bin/phone.mjs                 watch for calls and transcribe them as they're recorded (leave it running)
//   node bin/phone.mjs check           is everything in place? (recordings folder, ffmpeg, Whisper, model)
//   node bin/phone.mjs language <code> switch the current call's language (en, he, …, or auto)
//   node bin/phone.mjs probe           log what the phone's recorder does during a call (can it be read live?)
//   node bin/phone.mjs transcribe <f>  transcribe a recording that's already finished
//   node bin/phone.mjs simulate <f> [dir] [--speed N]
//                                      write a finished recording into <dir> bit by bit, at the speed it was
//                                      recorded (or N times faster), as the phone does during a call: for
//                                      trying it out without one
//
// The phone records each call to an .m4a in its recordings folder (Samsung: Recordings/Call). While the
// call is going, the file only has the audio, not the index a player needs; bin/m4a.mjs borrows the index
// of an earlier recording so the audio so far can be decoded anyway. Every few seconds the new audio is
// transcribed on the phone by whisper.cpp and appended to ~/.live-call-assistant/phone-calls/<call>/
// live.ndjson, in the same format as Wispr Flow's, so the rest of live-call-assistant works unchanged.
// When the recording is finished, refined.ndjson is written next to it to mark the call as over.
//
// Audio never leaves the phone. Only the text reaches Claude, when you ask Claude Code for help.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PHONE_DIR, PHONE_LANGUAGES_FILE, PHONE_LANGUAGE_FILE, PHONE_PID_FILE, collapseRepeats, config, phoneListenerPid } from './lib.mjs';
import { audioData, boxes, isComplete, playable } from './m4a.mjs';

const cfg = config();
const RATE = 16000;                  // Whisper wants 16 kHz mono
const SAFETY_S = 0.5;                // the last bit of a growing file may be a half-written frame
const MAX_CHUNK_S = 28;              // Whisper works on windows of up to 30 seconds
const STALL_S = 90;                  // a recording that stops growing without being finished is over
const AUDIO = /\.(m4a|mp4|3gp|aac|amr|mp3|wav|ogg|opus)$/i;
const PARTIAL_OK = /\.(m4a|mp4|3gp)$/i;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-phone-'));
process.on('exit', () => fs.rmSync(tmpDir, { recursive: true, force: true }));

const home = os.homedir();
// Termux's home, also when this runs inside Ubuntu (proot-distro) on the phone, whose home is /root.
const homes = [...new Set([home, '/data/data/com.termux/files/home'])];
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const which = (name) => (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, name)).find(exists) || null;

export function recordingsCandidates() {
  if (cfg.recordingsDir) return [cfg.recordingsDir];
  const roots = ['/sdcard', '/storage/emulated/0', path.join(home, 'storage', 'shared'),
    '/data/data/com.termux/files/home/storage/shared'];
  const subs = [
    'Recordings/Call',                        // Samsung (One UI 6 and later)
    'Call',                                   // Samsung, older
    'Recordings/Call recordings',
    'MIUI/sound_recorder/call_rec',           // Xiaomi
    'Music/Recordings/Call Recordings',       // OnePlus / Oppo / Realme
    'Recordings/PhoneRecord',
    'Record/Call',
  ];
  return roots.flatMap((r) => subs.map((s) => path.join(r, s)));
}

export const recordingsDir = () => recordingsCandidates().find(exists) || null;

export function whisperCli() {
  if (cfg.whisperCli) return cfg.whisperCli;
  return homes.map((h) => path.join(h, 'whisper.cpp', 'build', 'bin', 'whisper-cli')).find(exists) ||
    which('whisper-cli') || which('whisper-cpp') || null;
}

// Bigger models are better, especially for languages other than English, but slower.
const MODEL_ORDER = ['large-v3-turbo', 'medium', 'small', 'base', 'tiny'];
export function whisperModel() {
  if (cfg.whisperModel) return cfg.whisperModel;
  const dirs = homes.flatMap((h) => [path.join(h, 'whisper.cpp', 'models'), path.join(h, '.live-call-assistant', 'models')]);
  const files = dirs.filter(exists).flatMap((d) => fs.readdirSync(d)
    .filter((f) => /^ggml-.*\.bin$/.test(f) && !f.includes('silero')).map((f) => path.join(d, f)));
  const rank = (f) => { const i = MODEL_ORDER.findIndex((m) => path.basename(f).includes(m)); return i < 0 ? 99 : i; };
  return files.sort((a, b) => rank(a) - rank(b))[0] || null;
}

// The phone's call recordings, newest first. Android names a file that's still being written
// ".pending-<n>-<name>" on some phones; those count too.
function listRecordings(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => AUDIO.test(n)).map((n) => {
    const f = path.join(dir, n);
    try {
      const st = fs.statSync(f);
      return st.isFile() ? { f, name: n.replace(/^\.pending-\d+-/, ''), size: st.size, mtime: st.mtimeMs } : null;
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}

// Decode audio to 16 kHz mono 16-bit samples. Returns an Int16Array.
function decode(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
    { maxBuffer: 1 << 30 });
  if (r.error) throw r.error;
  const b = r.stdout || Buffer.alloc(0);
  return new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2));
}

let refCache = { f: null, mtime: 0, buf: null };
// A finished recording from the same folder, for its index (bin/m4a.mjs).
function reference(dir, except) {
  for (const r of listRecordings(dir)) {
    if (r.f === except || !PARTIAL_OK.test(r.f)) continue;
    if (refCache.f === r.f && refCache.mtime === r.mtime) return refCache.buf;
    const buf = fs.readFileSync(r.f);
    if (isComplete(buf)) { refCache = { f: r.f, mtime: r.mtime, buf }; return buf; }
  }
  return null;
}

// All the audio recorded so far. { samples, complete } or null if it can't be read yet.
function audioSoFar(rec, dir) {
  const buf = fs.readFileSync(rec.f);
  if (!PARTIAL_OK.test(rec.f)) return { samples: decode(rec.f), complete: true };   // other formats: once finished
  if (isComplete(buf)) return { samples: decode(rec.f), complete: true };
  const ref = reference(dir, rec.f);
  const fixed = ref && playable(buf, ref);
  if (!fixed) return null;
  const tmp = path.join(tmpDir, 'partial.mp4');
  fs.writeFileSync(tmp, fixed);
  return { samples: decode(tmp), complete: false };
}

const rms = (s, a, b) => {
  let sum = 0;
  for (let i = a; i < b; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / Math.max(1, b - a));
};

// Where to end a chunk: the quietest moment in its last two seconds, so words aren't cut in half.
function cutPoint(s, from, to) {
  const win = RATE / 10;
  let best = to, bestE = Infinity;
  for (let a = Math.max(from + RATE, to - 2 * RATE); a + win <= to; a += win / 2) {
    const e = rms(s, a, a + win);
    if (e < bestE) { bestE = e; best = a + win / 2; }
  }
  return Math.round(best);
}

function wav(s, a, b, file) {
  const n = b - a;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(file, Buffer.concat([h, Buffer.from(s.buffer, s.byteOffset + a * 2, n * 2)]));
}

const NOISE = /^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+)?\s*$/;    // "[BLANK_AUDIO]", "(music)", empty

// Transcribe samples a..b with whisper.cpp, in `language` ("auto" to detect it). Returns
// { segs: [{fromS, toS, text}] relative to a, language: what Whisper heard }.
function transcribe(s, a, b, language) {
  if (rms(s, a, b) < 30) return { segs: [], language: null };   // silence: Whisper tends to invent words for it
  const base = path.join(tmpDir, 'chunk');
  wav(s, a, b, `${base}.wav`);
  fs.rmSync(`${base}.json`, { force: true });
  // Whisper's encoder always works on 30 seconds (1500 positions); telling it how much audio there really
  // is (-ac) makes short pieces 2-3 times faster on a phone. A little extra room keeps the end intact.
  const ctx = Math.min(1500, Math.ceil(((b - a) / RATE) * 50) + 128);
  const args = ['-m', whisperModel(), '-f', `${base}.wav`, '-l', language, '-t', String(cfg.threads),
    '-ac', String(ctx), '-nf', '-oj', '-of', base, '-np'];
  // -nf: when Whisper's output looks wrong (it repeats itself, often on music or the wrong language), it
  // normally tries again up to five times, which on a phone means minutes. Live, a bad line is better than a
  // late one. And a run that still takes far longer than the audio is stopped: it's no use by then.
  const timeout = Math.round(Math.max(20e3, 3 * ((b - a) / RATE) * 1000));
  const cli = whisperCli();
  const r = /\.m?js$/.test(cli)              // a stand-in written in JavaScript (the tests use one)
    ? spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, timeout })
    : spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout });
  if (r.signal === 'SIGTERM' && r.status === null) {
    log(`gave up on ${((b - a) / RATE).toFixed(1)}s of audio after ${Math.round(timeout / 1000)}s`);
    return { segs: [], language: null };
  }
  if (r.error || r.status !== 0) {
    throw new Error(`whisper failed: ${r.error?.message || (r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  }
  const out = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  const segs = (out.transcription || []).map((t) => ({ fromS: t.offsets.from / 1000, toS: t.offsets.to / 1000, text: collapseRepeats(t.text.trim()) }))
    .filter((t) => !NOISE.test(t.text));
  return { segs, language: out.result?.language || null };
}

// When the recording started: from Samsung's "…_YYMMDD_HHMMSS" name, else worked out from its length.
function startedAt(name, mtime, seconds) {
  const m = name.match(/_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.\w+$/);
  if (m) {
    const t = new Date(2000 + +m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    if (Math.abs(t - Date.now()) < 7 * 864e5 || Math.abs(t - mtime) < 864e5) return t;
  }
  return mtime - seconds * 1000;
}

const callId = (name) => name.replace(AUDIO, '').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '-').slice(-60) || 'call';

// Who the call is with, from the recording's name: Samsung's "Call <contact or number>_YYMMDD_HHMMSS.m4a".
export function contactOf(name) {
  return name.replace(AUDIO, '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/_\d{6}_\d{6}$/, '')
    .replace(/^call\s+/i, '').trim() || null;
}

const readLearned = () => { try { return JSON.parse(fs.readFileSync(PHONE_LANGUAGES_FILE, 'utf8')); } catch { return {}; } };

// The language to start a call in: the first "languages" entry (config) whose name is part of the
// recording's name; else the language learned from earlier calls with this contact; else "language".
function languageFor(name) {
  const low = name.toLowerCase();
  const hit = Object.entries(cfg.languages || {}).find(([k]) => k && low.includes(k.toLowerCase()));
  if (hit) return { language: hit[1], how: 'config' };
  const learned = readLearned()[contactOf(name)];
  if (learned) return { language: learned.language, how: 'learned' };
  return { language: cfg.language, how: 'default' };
}

// Which language a finished call was in, for next time: Whisper's language detection on the loudest 20 s of
// the second half (the first half may be a recorded greeting or ringing). Only after the call, as it's slow.
function detectLanguage(s) {
  const W = 20 * RATE;
  let best = -1, at = -1;
  for (let a = Math.floor(s.length / 2); a + W <= s.length; a += 5 * RATE) {
    const r = rms(s, a, a + W);
    if (r > best) { best = r; at = a; }
  }
  if (at < 0 && s.length >= 5 * RATE) at = Math.max(0, s.length - W);
  if (at < 0 || rms(s, at, Math.min(s.length, at + W)) < 30) return null;
  const file = path.join(tmpDir, 'detect.wav');
  wav(s, at, Math.min(s.length, at + W), file);
  const cli = whisperCli();
  const args = ['-m', whisperModel(), '-f', file, '-l', 'auto', '-dl', '-t', String(cfg.threads), '-np'];
  const r = /\.m?js$/.test(cli)
    ? spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 120e3 })
    : spawnSync(cli, args, { encoding: 'utf8', timeout: 120e3 });
  const m = `${r.stdout}\n${r.stderr}`.match(/auto-detected language: (\w+) \(p = ([\d.]+)\)/);
  return m && Number(m[2]) >= 0.6 ? m[1] : null;
}

// Remember the contact's language for their next call: what was asked for during the call, or else, the
// first time, what was detected.
function learnLanguage(call, samples) {
  const contact = contactOf(call.rec.name);
  if (!contact || call.startHow === 'config') return;
  const learned = readLearned();
  let language, how;
  if (call.overrideAt) { language = call.language || 'auto'; how = 'asked during a call'; }
  else if (!learned[contact] && samples) {
    language = detectLanguage(samples);
    how = 'detected';
    if (!language) log(`${contact}: couldn't tell which language the call was in, so nothing learned yet`);
  }
  if (!language || learned[contact]?.language === language) return;
  learned[contact] = { language, how, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(PHONE_LANGUAGES_FILE), { recursive: true });
  fs.writeFileSync(PHONE_LANGUAGES_FILE, JSON.stringify(learned, null, 2) + '\n');
  log(`${contact}: ${language} from now on (${how})`);
}

// A language asked for during the call (`node bin/phone.mjs language en`), or just before it started.
function languageOverride(since) {
  try {
    const o = JSON.parse(fs.readFileSync(PHONE_LANGUAGE_FILE, 'utf8'));
    return o.at >= since - 120e3 ? o : null;
  } catch { return null; }
}

// One recording being transcribed.
class Call {
  constructor(rec, dir) {
    this.rec = rec;
    this.dir = dir;
    this.folder = path.join(PHONE_DIR, callId(rec.name));
    this.live = path.join(this.folder, 'live.ndjson');
    this.done = 0;                   // samples transcribed so far
    // Detecting the language takes Whisper longer than transcribing (10 s against 4 s for 8 s of speech on
    // a phone), so with "auto" it's detected on the first words of the call and kept for the rest of it.
    this.startedMs = Date.now();
    const start = languageFor(rec.name);
    this.startHow = start.how;
    this.language = start.language === 'auto' ? null : start.language;
    this.overrideAt = 0;
    this.lastSize = -1;
    this.lastGrowth = Date.now();
    this.finished = false;
    this.n = 0;
    fs.mkdirSync(this.folder, { recursive: true });
    fs.rmSync(path.join(this.folder, 'refined.ndjson'), { force: true });
    fs.writeFileSync(this.live, JSON.stringify({ meta: { v: 3, source: 'phone', recording: rec.name } }) + '\n');
  }

  write(segs, offsetS) {
    const lines = segs.map((t) => {
      this.n += 1;
      return JSON.stringify({
        id: `p${this.n}`, text: t.text, speaker: { id: 0, source: 'system', name: cfg.callLabel },
        startEpochMs: Math.round(this.t0 + (offsetS + t.fromS) * 1000),
        endEpochMs: Math.round(this.t0 + (offsetS + t.toS) * 1000),
      }) + '\n';
    });
    if (lines.length) fs.appendFileSync(this.live, lines.join(''));
  }

  finish(why, samples) {
    this.finished = true;
    fs.writeFileSync(path.join(this.folder, 'refined.ndjson'), '');
    log(`call over (${why}): ${this.n} lines in ${this.live}`);
    try { learnLanguage(this, samples); } catch (e) { log(`couldn't learn the call's language: ${e.message}`); }
  }

  // Transcribe whatever's new. Returns true if it did something.
  step() {
    let st;
    try { st = fs.statSync(this.rec.f); } catch {
      // Renamed when finished (".pending-…" -> final name): follow it.
      const moved = listRecordings(this.dir).find((r) => r.name === this.rec.name);
      if (!moved) { this.finish('the recording disappeared'); return false; }
      this.rec = moved;
      return true;
    }
    const grew = st.size !== this.lastSize;
    if (grew) { this.lastSize = st.size; this.lastGrowth = Date.now(); }
    const stalled = Date.now() - this.lastGrowth > STALL_S * 1000;
    if (!grew && !stalled && this.done > 0 && !this.completeSeen) return false;

    const t1 = Date.now();
    const audio = audioSoFar(this.rec, this.dir);
    const readMs = Date.now() - t1;
    if (!audio) {
      if (stalled) this.finish('the recording stopped and could not be read');
      else if (!this.warned && !reference(this.dir, this.rec.f)) { this.warned = true; log('the recording can\'t be read until the call ends (no earlier recording to borrow its index from); transcribing it then'); }
      return false;
    }
    const s = audio.samples;
    this.completeSeen = audio.complete;
    this.t0 ??= startedAt(this.rec.name, st.mtimeMs, s.length / RATE);
    const end = audio.complete || stalled ? s.length : s.length - SAFETY_S * RATE;
    let did = false;
    const o = languageOverride(this.startedMs);
    if (o && o.at !== this.overrideAt) {
      this.overrideAt = o.at;
      this.language = o.language === 'auto' ? null : o.language;
      log(`language: ${o.language} (asked for)`);
    }
    // Live help needs what's being said now, not what was said a minute ago: if transcribing has fallen
    // too far behind (a slow phone, or Termux not on screen), skip ahead to the latest audio.
    if (!audio.complete && !stalled && end - this.done > cfg.maxLagSeconds * RATE) {
      const to = Math.max(this.done, end - cfg.chunkSeconds * RATE);
      log(`fell ${Math.round((to - this.done) / RATE)}s behind; skipping ahead to keep up`);
      this.done = to;
    }
    while (end - this.done >= (audio.complete || stalled ? RATE * 0.3 : cfg.chunkSeconds * RATE)) {
      const limit = Math.min(end, this.done + MAX_CHUNK_S * RATE);
      const to = limit === end && (audio.complete || stalled) ? end : cutPoint(s, this.done, limit);
      const t2 = Date.now();
      const r = transcribe(s, this.done, to, this.language || 'auto');
      this.write(r.segs, this.done / RATE);
      if (!this.language && r.segs.length && r.language) {
        this.language = r.language;
        log(`language: ${r.language} (detected; kept for the rest of the call)`);
      }
      if (process.env.LCA_DEBUG) {
        log(`${((to - this.done) / RATE).toFixed(1)}s of audio: read ${readMs}ms, transcribed in ${Date.now() - t2}ms, ` +
          `${((end - to) / RATE).toFixed(1)}s still waiting`);
      }
      this.done = to;
      did = true;
      if (!audio.complete && !stalled) break;        // go back and read what's been recorded meanwhile
    }
    if ((audio.complete || stalled) && end - this.done < RATE * 0.3) this.finish(audio.complete ? 'recording finished' : 'recording stopped growing', s);
    return did;
  }
}

const log = (msg) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`);

function setupProblems() {
  const problems = [];
  if (!recordingsDir()) problems.push(`No call recordings folder found. Looked in:\n  ${recordingsCandidates().join('\n  ')}\n  Set "recordingsDir" in ~/.live-call-assistant/config.json.`);
  if (spawnSync('ffmpeg', ['-version']).error) problems.push('ffmpeg not found. In Termux: pkg install ffmpeg');
  if (!whisperCli()) problems.push('whisper.cpp\'s whisper-cli not found (see docs/phone.md), or set "whisperCli" in the config.');
  if (!whisperModel()) problems.push('No Whisper model found in ~/whisper.cpp/models (see docs/phone.md), or set "whisperModel" in the config.');
  return problems;
}

function watch() {
  const dir = recordingsDir();
  const problems = setupProblems();
  if (problems.length) { console.log(problems.join('\n')); process.exit(2); }
  const other = phoneListenerPid();
  if (other && other !== process.pid) { console.log(`Already running (process ${other}).`); process.exit(0); }
  fs.mkdirSync(path.dirname(PHONE_PID_FILE), { recursive: true });
  fs.writeFileSync(PHONE_PID_FILE, String(process.pid));
  const unregister = () => { try { if (fs.readFileSync(PHONE_PID_FILE, 'utf8') === String(process.pid)) fs.rmSync(PHONE_PID_FILE); } catch {} };
  process.on('exit', unregister);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
  if (cfg.source !== 'phone') {
    console.log('Note: "source" isn\'t "phone" in ~/.live-call-assistant/config.json, so Claude Code will still read ' +
      'Wispr Flow\'s transcripts. Set it to "phone" (docs/phone.md).');
  }
  log(`watching ${dir} (model ${path.basename(whisperModel())}, language ${cfg.language}). Ctrl+C to stop.`);
  // Recordings already there are left alone, except one changed in the last two minutes (a call that was
  // already going when this started). Each recording is handled once, by name: Android may rename it when
  // the call ends (".pending-…" -> the final name).
  const handled = new Set(listRecordings(dir).filter((r) => Date.now() - r.mtime >= 120e3).map((r) => r.name));
  let call = null;
  const tick = () => {
    try {
      if (call && !call.finished) {
        call.step();
        return;
      }
      call = null;
      const next = listRecordings(dir).find((r) => !handled.has(r.name));
      if (next) {
        handled.add(next.name);
        log(`call recording: ${next.name}`);
        call = new Call(next, dir);
        log(`language: ${call.language || 'auto'} (${{ config: 'from "languages" in the config', learned: 'learned from earlier calls', default: 'the default' }[call.startHow]})`);
        call.step();
      }
    } catch (e) {
      log(`error: ${e.message}`);
    }
  };
  (function loop() { tick(); setTimeout(loop, 2000); })();
}

function transcribeFile(file) {
  const problems = setupProblems().filter((p) => !p.startsWith('No call recordings'));
  if (problems.length) { console.log(problems.join('\n')); process.exit(2); }
  const st = fs.statSync(file);
  const rec = { f: path.resolve(file), name: path.basename(file), size: st.size, mtime: st.mtimeMs };
  const call = new Call(rec, path.dirname(rec.f));
  call.lastGrowth = 0;
  while (!call.finished) { call.step(); call.lastGrowth = 0; }   // it won't grow any more
  console.log(call.live);
}

// Write `file` into `dir` the way the phone does during a call: the audio grows at recording speed, and
// the index is added at the end.
async function simulate(file, dir, speed = 1) {
  const buf = fs.readFileSync(file);
  const data = audioData(buf);
  if (!data || !isComplete(buf)) { console.log('Needs a finished .m4a recording.'); process.exit(1); }
  const seconds = decode(file).length / RATE;
  const out = path.join(dir, `Call simulated_${new Date().toISOString().replace(/\D/g, '').slice(2, 8)}_${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.m4a`);
  const mdat = boxes(buf).find((b) => b.type === 'mdat');
  // While recording, the mdat's size isn't known yet: 0 for now (a 64-bit 0 if the file uses 64-bit sizes).
  const head = Buffer.concat([buf.subarray(0, mdat.start), mdat.header === 16
    ? Buffer.from([0, 0, 0, 1, 0x6d, 0x64, 0x61, 0x74, 0, 0, 0, 0, 0, 0, 0, 0])
    : Buffer.from([0, 0, 0, 0, 0x6d, 0x64, 0x61, 0x74])]);
  fs.writeFileSync(out, head);
  const perSecond = data.length / seconds;
  let written = 0;
  log(`simulating a ${Math.round(seconds)}s call: ${out}`);
  while (written < data.length) {
    await new Promise((r) => setTimeout(r, 1000 / speed));
    const n = Math.min(data.length - written, Math.round(perSecond));
    fs.appendFileSync(out, buf.subarray(data.offset + written, data.offset + written + n));
    written += n;
  }
  // Finish as the recorder does: the real mdat size, then the index.
  const fd = fs.openSync(out, 'r+');
  const size = Buffer.alloc(mdat.header === 16 ? 8 : 4);
  if (mdat.header === 16) size.writeBigUInt64BE(BigInt(data.length + 16));
  else size.writeUInt32BE(data.length + 8);
  fs.writeSync(fd, size, 0, size.length, mdat.start + (mdat.header === 16 ? 8 : 0));
  fs.closeSync(fd);
  fs.appendFileSync(out, buf.subarray(data.offset + data.length));
  log('simulated call finished');
}

// Does this phone let Termux read a call's recording while the call is going? Logs files appearing in,
// growing in and leaving the recordings folder (and the folder above it, in case the recorder writes
// there first), and every 5 seconds how much of a growing recording can be decoded. Needs no Whisper.
function probe() {
  const dir = recordingsDir();
  if (!dir) { console.log('No call recordings folder found.'); process.exit(2); }
  const dirs = [dir, path.dirname(dir)];
  const snapshot = () => {
    const m = new Map();
    for (const d of dirs) {
      let names = [];
      try { names = fs.readdirSync(d); } catch { continue; }
      for (const n of names) {
        const f = path.join(d, n);
        try { const st = fs.statSync(f); if (st.isFile()) m.set(f, st.size); } catch {}
      }
    }
    return m;
  };
  let seen = snapshot();
  const reported = new Map(seen);
  let lastReport = 0;
  log(`probing ${dirs.join(' and ')} (${seen.size} files there now). Make a call; Ctrl+C to stop.`);
  setInterval(() => {
    const now = snapshot();
    for (const [f, s] of now) if (!seen.has(f)) log(`new: ${path.basename(f)} (${s} bytes)`);
    for (const f of seen.keys()) if (!now.has(f)) log(`gone: ${path.basename(f)}`);
    seen = now;
    if (Date.now() - lastReport < 5000) return;
    lastReport = Date.now();
    for (const [f, s] of now) {
      if (reported.get(f) === s) continue;
      reported.set(f, s);
      if (!AUDIO.test(f)) { log(`changed: ${path.basename(f)} (${s} bytes)`); continue; }
      let state;
      try {
        const r = audioSoFar({ f }, path.dirname(f));
        state = r ? `${(r.samples.length / RATE).toFixed(1)}s of audio ${r.complete ? '(finished)' : 'so far'}` : 'not decodable yet';
      } catch (e) { state = `can't read: ${e.message}`; }
      log(`${path.basename(f)}: ${s} bytes, ${state}`);
    }
  }, 1000);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'check') {
  const dir = recordingsDir();
  const problems = setupProblems();
  console.log(`Recordings: ${dir || 'not found'}${dir ? ` (${listRecordings(dir).length} recordings)` : ''}`);
  console.log(`ffmpeg:     ${spawnSync('ffmpeg', ['-version']).error ? 'not found' : 'ok'}`);
  console.log(`Whisper:    ${whisperCli() || 'not found'}`);
  console.log(`Model:      ${whisperModel() || 'not found'}`);
  console.log(`Source:     ${cfg.source}${cfg.source === 'phone' ? '' : ' (set "source": "phone" in ~/.live-call-assistant/config.json)'}`);
  console.log(`Transcripts: ${PHONE_DIR}`);
  if (dir) {
    const ref = reference(dir, null);
    console.log(`Live:       ${ref ? 'ready (an earlier recording can lend its index)' : 'after the call only until one call has been recorded'}`);
  }
  if (problems.length) { console.log(`\n${problems.join('\n')}`); process.exit(2); }
  console.log('\nAll set. During a call, run a skill in Claude Code (for example /call-notes): that starts the listener too.');
} else if (cmd === 'transcribe' && rest[0]) {
  transcribeFile(rest[0]);
} else if (cmd === 'simulate' && rest[0]) {
  const i = rest.indexOf('--speed');
  const speed = i >= 0 ? Number(rest.splice(i, 2)[1]) || 1 : 1;
  await simulate(rest[0], rest[1] || recordingsDir(), speed);
} else if (cmd === 'language' && rest[0]) {
  fs.mkdirSync(path.dirname(PHONE_LANGUAGE_FILE), { recursive: true });
  fs.writeFileSync(PHONE_LANGUAGE_FILE, JSON.stringify({ language: rest[0], at: Date.now() }) + '\n');
  console.log(`Transcribing the current call (or the next one, if it starts in the next two minutes) in: ${rest[0]}`);
} else if (cmd === 'probe') {
  probe();
} else if (!cmd || cmd === 'watch') {
  watch();
} else {
  console.log('Usage: node bin/phone.mjs [watch] | check | language <en|he|auto|…> | probe | transcribe <file> | simulate <file> [dir]');
  process.exit(1);
}
