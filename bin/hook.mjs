#!/usr/bin/env node
// Claude Code UserPromptSubmit hook. Does nothing unless live mode is on.
//
// While live mode is on (node bin/live.mjs on <skill> [more skills]):
//   - a short message (any character, or a few words like "pricing") becomes a request for the active
//     skill(s): the hook reads the transcript and hands it to Claude, so Claude can answer straight away;
//   - "off", "end", "stop", "live off", "<skill> off" (with or without a slash) switch live mode off;
//   - longer messages only get a one-line reminder that live mode is on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BIN, HOME, config, languageRequest, q, readState } from './lib.mjs';

let prompt = '';
try { prompt = (JSON.parse(fs.readFileSync(0, 'utf8')).prompt || '').trim(); } catch {}

const state = readState();
if (!state) process.exit(0);

const skills = state.skills || [state.skill];
const names = skills.map((s) => `/${s}`).join(', ');
const several = skills.length > 1;
const say = (text) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text },
  }));
  process.exit(0);
};

const p = prompt.toLowerCase().replace(/^\//, '');
const esc = (s) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ours = ['live', 'call', ...skills.map(esc)].join('|');
const stopRe = new RegExp(`^((${ours})\\s*(end|stop|off)|(end|stop)\\s*(live|call)|end|stop|off)\\W*$`);
if (stopRe.test(p)) {
  say(`LIVE MODE: the user wants to stop. Run \`node ${q(path.join(BIN, 'live.mjs'))} off\`, ` +
    `then follow any wrap-up steps in ${names}.`);
}
// On a phone (docs/phone.md), "English", "he", "switch to Hebrew", … changes the language the call is
// transcribed in, straight away.
const lang = config().source === 'phone' && languageRequest(prompt);
if (lang) {
  let done;
  try {
    done = execFileSync(process.execPath, [path.join(BIN, 'phone.mjs'), 'language', lang], { encoding: 'utf8', timeout: 8000 }).trim();
  } catch (e) { done = `[failed: ${String(e.message).split('\n')[0]}]`; }
  say(`LIVE MODE: the user asked to transcribe the call in "${lang}". Done: ${done}. Confirm in one short line, ` +
    `then keep listening as before.`);
}
const mentionsOurs = skills.some((s) => p.startsWith(s.toLowerCase())) || p.startsWith('live');
if (prompt.startsWith('/') && !mentionsOurs) process.exit(0);

if (prompt.length > config().shortMessageChars && !mentionsOurs) {
  say(`LIVE MODE is on for ${names} (a call is in progress). If this message asks for help with the call, ` +
    `handle it that way; otherwise handle it normally.`);
}

let transcript;
try {
  transcript = execFileSync(process.execPath, [path.join(BIN, 'transcript.mjs'), '300'], { encoding: 'utf8', timeout: 8000 });
} catch (e) {
  transcript = e.stdout || `[could not read the transcript: ${String(e.message).split('\n')[0]}]`;
}

const skillsDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills');
const combine = several
  ? `Several skills are active, in priority order: ${names}. Combine them as ` +
    `${q(path.join(HOME, 'docs', 'listening.md'))} ("Several skills at once") describes. If a skill's instructions ` +
    `aren't in this conversation yet, read ${q(path.join(skillsDir, '<name>', 'SKILL.md'))} first. `
  : '';

say(
  `LIVE MODE: treat this message as a request for ${names} (use the message as a hint if it means anything, ` +
  `otherwise ignore it). ${combine}The transcript below is fresh, so don't read it again: respond to it now, ` +
  `or say "Listening…" in one line if there's nothing yet. Then keep listening as ` +
  `${q(path.join(HOME, 'docs', 'listening.md'))} describes: start \`node ${q(path.join(BIN, 'transcript.mjs'))} ` +
  `--wait 120 --after <cursor>\` with run_in_background (the cursor is the last line below) and END YOUR TURN ` +
  `with your answer as the last thing you write.\n\n` + transcript,
);
