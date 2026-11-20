// End-to-end tests against a fake Wispr folder and a fake Claude Code config. Run: npm test
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-test-'));
const env = {
  ...process.env,
  LCA_WISPR_DIR: path.join(tmp, 'meetings'),
  LCA_DATA_DIR: path.join(tmp, 'data'),
  CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
};
const meeting = path.join(env.LCA_WISPR_DIR, 'abc');
const live = path.join(meeting, 'live.ndjson');
fs.mkdirSync(meeting, { recursive: true });

let n = 0;
const line = (source, text) => {
  const t = Date.now();
  n += 1;
  return JSON.stringify({ id: `l${n}`, text, speaker: { id: 1, source, name: null }, startEpochMs: t, endEpochMs: t }) + '\n';
};
fs.writeFileSync(live, JSON.stringify({ meta: { v: 3 } }) + '\n' + line('system', 'Hi there.') + line('mic', 'Hello!'));

const run = (script, args = [], input) =>
  execFileSync(process.execPath, [path.join(ROOT, 'bin', script), ...args], { env, encoding: 'utf8', input });
const hook = (prompt) => run('hook.mjs', [], JSON.stringify({ prompt }));

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

await test('transcript: look-back with labels and cursor', () => {
  const out = run('transcript.mjs', ['300']);
  assert.match(out, /call in progress/);
  assert.match(out, /Them: Hi there\./);
  assert.match(out, /You: Hello!/);
  assert.match(out, /# cursor 2$/m);
});

await test('transcript: --wait picks up a question split across two lines', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'transcript.mjs'), '--wait', '20', '--after', '2'], { env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const done = new Promise((r) => child.on('exit', r));
  await new Promise((r) => setTimeout(r, 1200));
  fs.appendFileSync(live, line('system', 'So tell me about a time where you—'));
  await new Promise((r) => setTimeout(r, 1500));
  fs.appendFileSync(live, line('system', 'had to give feedback.'));
  await done;
  assert.match(out, /\(before\) .*You: Hello!/);
  assert.match(out, /Them: So tell me about a time where you— had to give feedback\./);
  assert.match(out, /# cursor 4/);
});

await test('transcript: --wait with nothing new times out cleanly', () => {
  const out = run('transcript.mjs', ['--wait', '2', '--after', '4']);
  assert.match(out, /nothing new in 2s/);
});

await test('hook: silent when live mode is off', () => {
  assert.equal(hook('x'), '');
});

await test('hook: short message gets the transcript, long one a reminder', () => {
  run('live.mjs', ['on', 'call-notes']);
  const short = JSON.parse(hook('x')).hookSpecificOutput.additionalContext;
  assert.match(short, /request for the \/call-notes skill/);
  assert.match(short, /had to give feedback/);
  const long = JSON.parse(hook('a'.repeat(100))).hookSpecificOutput.additionalContext;
  assert.match(long, /LIVE MODE is on/);
  assert.equal(hook('/some-other-command'), '');
});

await test('hook: "off" and friends switch it off', () => {
  for (const p of ['off', '/live off', 'end', 'stop live', '/call-notes off', 'call-notes end']) {
    assert.match(JSON.parse(hook(p)).hookSpecificOutput.additionalContext, /wants to stop/, p);
  }
  run('live.mjs', ['off']);
  assert.equal(hook('x'), '');
});

await test('installer: adds the hook alongside existing ones, and uninstalls cleanly', () => {
  const settings = path.join(env.CLAUDE_CONFIG_DIR, 'settings.json');
  fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  const existing = { theme: 'dark', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  fs.writeFileSync(settings, JSON.stringify(existing));

  run('install.mjs', ['--notes', path.join(tmp, 'notes')]);
  run('install.mjs', ['--force']); // running twice must not add a second hook
  const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  const cmds = s.hooks.UserPromptSubmit.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(s.theme, 'dark');
  assert.equal(cmds.filter((c) => c === 'echo mine').length, 1);
  assert.equal(cmds.filter((c) => c.includes('hook.mjs')).length, 1);
  const skill = fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'skills', 'call-notes', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /\{\{/);

  run('install.mjs', ['--uninstall']);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(after.hooks.UserPromptSubmit, existing.hooks.UserPromptSubmit);
  assert.ok(!fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, 'skills', 'call-notes')));
});

await test('installer skips the template; new-skill fills it in', () => {
  run('install.mjs', ['--no-hook']);
  assert.ok(!fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, 'skills', '_template')));
  const out = run('new-skill.mjs', ['sales-helper']);
  assert.match(out, /Created/);
  const skill = fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'skills', 'sales-helper', 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: sales-helper$/m);
  assert.match(skill, /live\.mjs" on sales-helper/);
  assert.doesNotMatch(skill, /\{\{/);
  assert.throws(() => run('new-skill.mjs', ['sales-helper'])); // won't overwrite
  assert.throws(() => run('new-skill.mjs', ['Bad Name']));
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
