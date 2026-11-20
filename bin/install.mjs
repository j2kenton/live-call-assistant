#!/usr/bin/env node
// Install live-call-assistant into Claude Code for the current user.
//
//   node bin/install.mjs                 add the hook and install the example skills
//   node bin/install.mjs --notes <dir>   notes folder for the call-notes skill (default: ~/call-notes)
//   node bin/install.mjs --no-hook       skills only
//   node bin/install.mjs --no-skills     hook only
//   node bin/install.mjs --force         overwrite skills that are already installed
//   node bin/install.mjs --uninstall     remove the hook and the skills this installer added
//
// Your Claude Code settings are backed up before they're changed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BIN, HOME } from './lib.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsFile = path.join(claudeDir, 'settings.json');
const skillsDir = path.join(claudeDir, 'skills');
const MARK = 'live-call-assistant';
const fwd = (p) => p.replace(/\\/g, '/');
const hookCommand = `node "${fwd(path.join(BIN, 'hook.mjs'))}"`;
const isOurs = (h) => typeof h?.command === 'string' &&
  (h.command.includes(fwd(path.join(BIN, 'hook.mjs'))) || (h.command.includes('hook.mjs') && h.command.includes(MARK)));

function readSettings() {
  if (!fs.existsSync(settingsFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    console.error(`Couldn't parse ${settingsFile}. Fix it (or add the hook by hand, see the README) and try again.`);
    process.exit(1);
  }
}

function writeSettings(s) {
  fs.mkdirSync(claudeDir, { recursive: true });
  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, `${settingsFile}.bak-${MARK}`);
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n');
}

function removeHook(s) {
  const groups = s.hooks?.UserPromptSubmit;
  if (!Array.isArray(groups)) return false;
  const before = JSON.stringify(groups);
  s.hooks.UserPromptSubmit = groups
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length);
  if (!s.hooks.UserPromptSubmit.length) delete s.hooks.UserPromptSubmit;
  return JSON.stringify(s.hooks.UserPromptSubmit || []) !== before;
}

const exampleSkills = fs.readdirSync(path.join(HOME, 'skills'));

if (has('--uninstall')) {
  const s = readSettings();
  if (removeHook(s)) { writeSettings(s); console.log(`Removed the hook from ${settingsFile}`); }
  for (const name of exampleSkills) {
    const f = path.join(skillsDir, name, 'SKILL.md');
    if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(`${MARK}:`)) {
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
      console.log(`Removed skill /${name}`);
    }
  }
  console.log('Done. Your settings and data folder (~/.live-call-assistant) are otherwise untouched.');
  process.exit(0);
}

if (!has('--no-hook')) {
  const s = readSettings();
  removeHook(s);
  s.hooks ??= {};
  s.hooks.UserPromptSubmit ??= [];
  s.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: hookCommand, timeout: 15 }] });
  writeSettings(s);
  console.log(`Hook added to ${settingsFile} (backup: settings.json.bak-${MARK})`);
}

if (!has('--no-skills')) {
  const notes = fwd(path.resolve(opt('--notes', path.join(os.homedir(), 'call-notes'))));
  for (const name of exampleSkills) {
    const src = path.join(HOME, 'skills', name, 'SKILL.md');
    const dest = path.join(skillsDir, name, 'SKILL.md');
    if (fs.existsSync(dest) && !has('--force')) {
      console.log(`Skipped /${name}: already installed (use --force to overwrite)`);
      continue;
    }
    const text = fs.readFileSync(src, 'utf8')
      .replaceAll('{{LCA}}', fwd(HOME))
      .replaceAll('{{NOTES_DIR}}', notes);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    console.log(`Installed skill /${name}`);
  }
}

console.log('\nNext: restart Claude Code (or open /hooks once), then run `node bin/live.mjs check` during a call.');
