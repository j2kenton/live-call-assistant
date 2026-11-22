// Shared paths and settings for live-call-assistant.
import { spawn, spawnSync } from 'node:child_process';
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
  source: 'wispr',         // where transcripts come from: 'wispr' (Wispr Flow) or 'phone' (see docs/phone.md)
  wisprDir: null,          // auto-detected when null
  settleSeconds: 4,        // a speaker pause this long ends a chunk of new speech
  maxAgeHours: 4,          // live mode switches itself off after this long
  shortMessageChars: 60,   // messages up to this length count as "help me now"
  youLabel: 'You',         // label for your microphone
  themLabel: 'Them',       // label for the other side of the call
  // Phone (source 'phone', docs/phone.md): the phone's call recordings, transcribed on the phone.
  recordingsDir: null,     // auto-detected when null (Samsung: Recordings/Call)
  whisperCli: null,        // whisper.cpp's whisper-cli; auto-detected when null
  whisperModel: null,      // a whisper.cpp ggml model file; auto-detected when null
  language: 'en',          // the calls' language for Whisper ('en', 'he', ...), or 'auto' (slow on a phone)
  threads: 4,              // CPU threads for Whisper
  languages: {},           // per contact: { "part of the contact's name": "en" }, checked against the recording's name
  chunkSeconds: 8,         // transcribe the call in pieces of about this length
  maxLagSeconds: 20,       // fallen further behind than this, live transcription skips ahead
  callLabel: 'Call',       // phone recordings mix both sides into one track, so lines get this label
};

// Phone transcripts are written here, in the same layout as Wispr Flow's meetings folder.
export const PHONE_DIR = path.join(DATA_DIR, 'phone-calls');
// The phone listener (bin/phone.mjs) writes its process id here while it runs.
export const PHONE_PID_FILE = path.join(DATA_DIR, 'phone-listener.pid');

// The running phone listener's process id, or null.
export function phoneListenerPid() {
  try {
    const pid = Number(fs.readFileSync(PHONE_PID_FILE, 'utf8'));
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
}

// Start the phone listener if it isn't running, so that on a phone, as with Wispr Flow on a computer,
// running a skill is all it takes. In Termux it gets a tmux session of its own: that keeps it running
// after Claude Code is closed (and Ubuntu inside Termux stops everything it started when you leave it).
// Returns a line to show, or null if it was already running.
export function startPhoneListener() {
  if (phoneListenerPid()) return null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Real paths: from Ubuntu inside Termux, ~ is Ubuntu's own home, which Termux can't see.
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const script = path.join(real(BIN), 'phone.mjs');
  const dataDir = real(DATA_DIR);
  const logFile = path.join(dataDir, 'phone.log');
  const prefix = '/data/data/com.termux/files/usr';
  const tmux = path.join(prefix, 'bin', 'tmux');
  if (process.env.LCA_TMUX !== 'none' && fs.existsSync(tmux)) {
    // Termux's own tmux server, found by its socket, so this works from inside Ubuntu too.
    let sock = null;
    try {
      const run = path.join(prefix, 'var', 'run');
      const d = fs.readdirSync(run).find((n) => n.startsWith('tmux-') && fs.existsSync(path.join(run, n, 'default')));
      if (d) sock = path.join(run, d, 'default');
    } catch {}
    const wake = fs.existsSync(path.join(prefix, 'bin', 'termux-wake-lock')) ? `${prefix}/bin/termux-wake-lock; ` : '';
    const env = `LCA_DATA_DIR=${q(dataDir)} `;
    spawnSync(tmux, [...(sock ? ['-S', sock] : []), 'new-session', '-d', '-s', 'live-call-assistant',
      `${wake}${env}exec ${q(real(process.execPath))} ${q(script)} >> ${q(logFile)} 2>&1`]);
  } else {
    const out = fs.openSync(logFile, 'a');
    spawn(process.execPath, [script], { detached: true, stdio: ['ignore', out, out] }).unref();
  }
  for (let i = 0; i < 30 && !phoneListenerPid(); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  return phoneListenerPid()
    ? `Started the phone listener (it transcribes calls as your phone records them; log: ${logFile}).`
    : `Couldn't start the phone listener: see ${logFile}, or start it yourself in Termux with \`node ${q(script)}\`.`;
}

// bin/save-log.mjs logs each time Wispr writes the live transcript, to learn when it saves.
export const SAVE_LOG = path.join(DATA_DIR, 'wispr-saves.log');
export const SAVE_LOG_PID = path.join(DATA_DIR, 'save-log.pid');

// Start the save logger in the background if it isn't running. It stops by itself when live mode goes off.
export function startSaveLog() {
  try {
    process.kill(Number(fs.readFileSync(SAVE_LOG_PID, 'utf8')), 0);
    return;                    // already running
  } catch {}
  spawn(process.execPath, [path.join(BIN, 'save-log.mjs')], { detached: true, stdio: 'ignore' }).unref();
}

// Set during a call (`node bin/phone.mjs language en`) to change the current call's language.
export const PHONE_LANGUAGE_FILE = path.join(DATA_DIR, 'phone-language.json');
// Each contact's language, learned from their calls (bin/phone.mjs).
export const PHONE_LANGUAGES_FILE = path.join(DATA_DIR, 'phone-languages.json');

// What a language request means: "en", "English", "switch to Hebrew", "עברית", "language: fr", … -> a
// Whisper language code, or null. A bare two-letter code only counts for en and he: "ok" or "hi" aren't requests.
const LANGUAGE_WORDS = { english: 'en', אנגלית: 'en', hebrew: 'he', עברית: 'he', ivrit: 'he', auto: 'auto', en: 'en', he: 'he' };
export function languageRequest(text) {
  const m = text.trim().toLowerCase().match(/^((?:switch|change)(?: it)? to |lang(?:uage)?:? |in )?(\p{L}{2,10})[.!]?$/u);
  if (!m) return null;
  if (LANGUAGE_WORDS[m[2]]) return LANGUAGE_WORDS[m[2]];
  return m[1] && /^[a-z]{2}$/.test(m[2]) ? m[2] : null;
}

export function config() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  const c = { ...DEFAULTS, ...user };
  if (process.env.LCA_WISPR_DIR) c.wisprDir = process.env.LCA_WISPR_DIR;
  if (process.env.LCA_SOURCE) c.source = process.env.LCA_SOURCE;
  return c;
}

// The folder of call transcripts that transcript.mjs reads: Wispr Flow's, or the phone's.
export function transcriptDir() {
  if (config().source === 'phone') {
    fs.mkdirSync(PHONE_DIR, { recursive: true });
    return PHONE_DIR;
  }
  return wisprDir();
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

// Whisper sometimes gets stuck repeating itself ("okay, okay, okay, …" dozens of times), mostly on hold
// music. Keep at most two of anything (a word or a phrase of up to six words) repeated back to back.
export function collapseRepeats(text) {
  const w = text.split(/\s+/).filter(Boolean);
  const key = (x) => x.replace(/[\p{P}\u200e\u200f\u202a-\u202e]/gu, '').toLowerCase();
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i + 3 * n <= w.length; i++) {
      const same = (a, b) => { for (let k = 0; k < n; k++) if (key(w[a + k]) !== key(w[b + k])) return false; return true; };
      let j = i + 2 * n;
      while (j + n <= w.length && same(i, j) && same(i, i + n)) j += n;
      if (j > i + 2 * n) w.splice(i + 2 * n, j - (i + 2 * n));
    }
  }
  return w.join(' ');
}
