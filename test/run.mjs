// End-to-end tests against a fake Wispr folder and a fake Claude Code config. Run: npm test
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collapseRepeats, languageRequest } from '../bin/lib.mjs';

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
  assert.match(short, /request for \/call-notes \(/);
  assert.doesNotMatch(short, /Several skills/);
  assert.match(short, /had to give feedback/);
  const long = JSON.parse(hook('a'.repeat(100))).hookSpecificOutput.additionalContext;
  assert.match(long, /LIVE MODE is on/);
  assert.equal(hook('/some-other-command'), '');
});

await test('hook: on a phone, "English" or "switch to Hebrew" changes the call\'s language', () => {
  for (const [said, code] of [['English', 'en'], ['switch to Hebrew', 'he'], ['עברית', 'he'], ['he', 'he'], ['language: fr', 'fr']]) {
    assert.equal(languageRequest(said), code, said);
  }
  for (const said of ['ok', 'hi', 'pricing', 'ru', 'x']) assert.equal(languageRequest(said), null, said);
  run('live.mjs', ['on', 'call-notes']);
  const phone = (prompt) => execFileSync(process.execPath, [path.join(ROOT, 'bin', 'hook.mjs')],
    { env: { ...env, LCA_SOURCE: 'phone' }, encoding: 'utf8', input: JSON.stringify({ prompt }) });
  assert.match(JSON.parse(phone('English')).hookSpecificOutput.additionalContext, /transcribe the call in "en"/);
  const f = path.join(env.LCA_DATA_DIR, 'phone-language.json');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).language, 'en');
  fs.rmSync(f);
  // Not on a phone: just a short message.
  assert.match(JSON.parse(hook('English')).hookSpecificOutput.additionalContext, /request for \/call-notes/);
});

await test('hook: "off" and friends switch it off', () => {
  for (const p of ['off', '/live off', 'end', 'stop live', '/call-notes off', 'call-notes end']) {
    assert.match(JSON.parse(hook(p)).hookSpecificOutput.additionalContext, /wants to stop/, p);
  }
  run('live.mjs', ['off']);
  assert.equal(hook('x'), '');
});

await test('several skills at once: priority order, combined request, stop with any name', () => {
  assert.match(run('live.mjs', ['on', 'call-notes', '/call-research', 'call-notes']), /ON for \/call-notes, \/call-research \(/);
  assert.match(run('live.mjs', ['status']), /\/call-notes, \/call-research since/);
  const ctx = JSON.parse(hook('x')).hookSpecificOutput.additionalContext;
  assert.match(ctx, /request for \/call-notes, \/call-research/);
  assert.match(ctx, /Several skills are active, in priority order/);
  assert.match(JSON.parse(hook('/call-research off')).hookSpecificOutput.additionalContext, /wants to stop/);
  assert.match(JSON.parse(hook('a'.repeat(100))).hookSpecificOutput.additionalContext, /LIVE MODE is on for \/call-notes, \/call-research/);
  run('live.mjs', ['off']);
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
  const coach = fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'skills', 'call-coach', 'SKILL.md'), 'utf8');
  assert.match(coach, /^name: call-coach$/m);
  assert.doesNotMatch(coach, /\{\{/);
  const negotiate = fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'skills', 'call-negotiate', 'SKILL.md'), 'utf8');
  assert.match(negotiate, /^name: call-negotiate$/m);
  assert.doesNotMatch(negotiate, /\{\{/);
  // The files the skill points at exist in the repo.
  for (const f of ['playbook.md', 'theory.md', 'prep-example.md', 'resources/README.md', 'resources/general-negotiation.md', 'resources/salary-and-offers.md', 'resources/tech-offers-interviewing-io.md', 'resources/fearless-salary-negotiation-doody.md',
    'resources/patrick-mckenzie-salary-negotiation.md', 'resources/haseeb-qureshi-ten-rules.md', 'resources/malhotra-15-rules.md',
    'resources/principled-negotiation.md', 'resources/difficult-conversations.md', 'resources/first-offers-research.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'call-negotiate', f)), f);
  }

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

// Phone recordings (docs/phone.md). Needs ffmpeg, to make a test recording; skipped without it.
const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
let hasFfmpeg = true;
try { ffmpeg(['-version']); } catch { hasFfmpeg = false; }

if (!hasFfmpeg) {
  console.log('skip - phone tests (ffmpeg not found)');
} else {
  const { boxes, isComplete, playable } = await import('../bin/m4a.mjs');
  const rec = path.join(tmp, 'rec');
  fs.mkdirSync(rec);
  // A finished "earlier call" and a "call" to replay: tones, recorded the way phones do (AAC in .m4a).
  const tone = (f, secs, hz) => ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', f]);
  const earlier = path.join(rec, 'Call Earlier_260101_100000.m4a');
  const sample = path.join(tmp, 'sample.m4a');
  tone(earlier, 3, 300);
  tone(sample, 12, 440);
  fs.utimesSync(earlier, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  // 48 kHz, as recorded. A cut-off file's last frame is incomplete, so ffmpeg exits with an error after it.
  const pcm = (f) => spawnSync('ffmpeg', ['-v', 'quiet', '-i', f, '-f', 's16le', '-ac', '1', '-'], { maxBuffer: 1 << 28 }).stdout;

  await test('phone: Whisper repeating itself is cut down to two', () => {
    assert.equal(collapseRepeats('okay, okay, okay, okay, okay, okay, so'), 'okay, okay, so');
    assert.equal(collapseRepeats('What is going on? What is going on? What is going on? Hello'), 'What is going on? What is going on? Hello');
    assert.equal(collapseRepeats('no no, I said no'), 'no no, I said no');
  });

  await test('phone: audio of a recording still being written can be decoded', () => {
    const full = fs.readFileSync(sample);
    const mdat = boxes(full).find((b) => b.type === 'mdat');
    const partial = full.subarray(0, mdat.start + Math.floor(mdat.size / 2));  // half-way through, no index yet
    assert.equal(isComplete(partial), false);
    assert.equal(isComplete(full), true);
    const fixed = path.join(tmp, 'fixed.mp4');
    fs.writeFileSync(fixed, playable(partial, fs.readFileSync(earlier)));
    const got = pcm(fixed);
    const want = pcm(sample);
    assert.ok(got.length > want.length * 0.4 && got.length < want.length * 0.6, `${got.length} of ${want.length}`);
    // The same audio. (ffmpeg's encoder adds a short lead-in that only the finished file's index trims, so
    // allow an offset of up to 0.03s. Samsung's recordings have none.)
    const mid = Math.floor(got.length / 4) * 2;
    const window = got.subarray(mid, mid + 4000);
    const same = Array.from({ length: 1600 }, (_, k) => mid - 3200 + 2 * k).some((o) => want.subarray(o, o + 4000).equals(window));
    assert.ok(same, 'decoded audio differs from the original');
  });

  await test('phone: a call is transcribed while it is recorded, then marked finished', async () => {
    const data = path.join(tmp, 'phone-data');
    fs.mkdirSync(data);
    const fake = path.join(tmp, 'fake-whisper.mjs');
    fs.writeFileSync(fake, `import fs from 'node:fs';
const a = process.argv, f = a[a.indexOf('-f') + 1], of = a[a.indexOf('-of') + 1];
if (a.includes('-dl')) { console.error('whisper_full_with_state: auto-detected language: ' + (process.env.FAKE_DETECT || 'fr') + ' (p = 0.95)'); process.exit(0); }
const s = (fs.statSync(f).size - 44) / 32000;
if (process.env.FAKE_LANG_LOG) fs.appendFileSync(process.env.FAKE_LANG_LOG, a[a.indexOf('-l') + 1] + '\\n');
fs.writeFileSync(of + '.json', JSON.stringify({ result: { language: 'he' }, transcription: [{ offsets: { from: 0, to: Math.round(s * 1000) }, text: ' piece of ' + s.toFixed(0) + 's' }] }));`);
    fs.writeFileSync(path.join(tmp, 'model.bin'), '');
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({
      source: 'phone', recordingsDir: rec, whisperCli: fake, whisperModel: path.join(tmp, 'model.bin'), chunkSeconds: 3, language: 'auto',
    }));
    const langLog = path.join(tmp, 'languages.txt');
    const penv = { ...env, LCA_DATA_DIR: data, FAKE_LANG_LOG: langLog };
    delete penv.LCA_WISPR_DIR;
    const watcher = spawn(process.execPath, [path.join(ROOT, 'bin', 'phone.mjs')], { env: penv });
    let log = '';
    watcher.stdout.on('data', (d) => { log += d; });
    await new Promise((r) => setTimeout(r, 1500));
    const sim = spawn(process.execPath, [path.join(ROOT, 'bin', 'phone.mjs'), 'simulate', sample, rec, '--speed', '2'], { env: penv });
    let simDone = false;
    const simExit = new Promise((r) => sim.on('exit', () => { simDone = true; r(); }));
    // While the "call" is still going, the transcript should already have something in it.
    let mid = '';
    while (!simDone && !/piece of/.test(mid)) {
      await new Promise((r) => setTimeout(r, 300));
      mid = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'transcript.mjs'), '600'], { env: penv, encoding: 'utf8' }).stdout;
    }
    await simExit;
    for (let i = 0; i < 20 && !/call over/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
    watcher.kill();
    assert.match(mid, /call in progress/);
    assert.match(mid, /Call: piece of \d+s/);
    assert.match(log, /call over \(recording finished\)/);
    // The language is detected on the first words, then kept: detecting it every time is too slow on a phone.
    assert.match(log, /language: he \(detected/);
    const langs = fs.readFileSync(langLog, 'utf8').trim().split('\n');
    assert.equal(langs[0], 'auto');
    assert.ok(langs.length >= 2 && langs.slice(1).every((l) => l === 'he'), `languages asked for: ${langs}`);
    assert.doesNotMatch(log, /Earlier/);                 // recordings from before it started are left alone
    const after = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'transcript.mjs'), '600'], { env: penv, encoding: 'utf8' });
    assert.match(after, /call FINISHED/);
    const secs = [...after.matchAll(/piece of (\d+)s/g)].reduce((t, m) => t + Number(m[1]), 0);
    assert.ok(secs >= 10 && secs <= 13, `transcribed ${secs}s of 12s`);
  });

  await test('phone: a contact\'s language is learned on the first call and used on the next', async () => {
    const data = path.join(tmp, 'phone-data-learn');
    const rec3 = path.join(tmp, 'recordings-learn');
    fs.mkdirSync(data);
    fs.mkdirSync(rec3);
    const earlier = path.join(rec3, 'Call earlier_250101_090000.m4a');
    fs.copyFileSync(sample, earlier);
    fs.utimesSync(earlier, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({
      source: 'phone', recordingsDir: rec3, whisperCli: path.join(tmp, 'fake-whisper.mjs'),
      whisperModel: path.join(tmp, 'model.bin'), chunkSeconds: 3, language: 'en',
    }));
    const langLog = path.join(tmp, 'languages-learn.txt');
    const penv = { ...env, LCA_DATA_DIR: data, FAKE_LANG_LOG: langLog, FAKE_DETECT: 'he' };
    delete penv.LCA_WISPR_DIR;
    const watcher = spawn(process.execPath, [path.join(ROOT, 'bin', 'phone.mjs')], { env: penv });
    let log = '';
    watcher.stdout.on('data', (d) => { log += d; });
    const call = async (k) => {
      spawnSync(process.execPath, [path.join(ROOT, 'bin', 'phone.mjs'), 'simulate', sample, rec3, '--speed', '4'], { env: penv });
      for (let i = 0; i < 40 && (log.match(/call over/g) || []).length < k; i++) await new Promise((r) => setTimeout(r, 500));
    };
    await new Promise((r) => setTimeout(r, 1500));
    await call(1);
    for (let i = 0; i < 20 && !/from now on/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
    const first = fs.readFileSync(langLog, 'utf8').trim().split('\n');
    await new Promise((r) => setTimeout(r, 1100));      // the next recording gets a new name (to the second)
    await call(2);
    watcher.kill();
    assert.ok(first.every((l) => l === 'en'), `first call: ${first}`);     // the default
    assert.match(log, /simulated: he from now on \(detected\)/);
    const learned = JSON.parse(fs.readFileSync(path.join(data, 'phone-languages.json'), 'utf8'));
    assert.equal(learned.simulated.language, 'he');
    assert.match(log, /language: he \(learned from earlier calls\)/);
    const second = fs.readFileSync(langLog, 'utf8').trim().split('\n').slice(first.length);
    assert.ok(second.length && second.every((l) => l === 'he'), `second call: ${second}`);
  });

  await test('phone: running a skill starts the phone listener, as Wispr Flow is already running on a computer', async () => {
    const data = path.join(tmp, 'phone-data-start');
    const empty = path.join(tmp, 'recordings-empty');      // no calls to transcribe: it stops at once when asked
    fs.mkdirSync(data);
    fs.mkdirSync(empty);
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({
      source: 'phone', recordingsDir: empty, whisperCli: path.join(tmp, 'fake-whisper.mjs'), whisperModel: path.join(tmp, 'model.bin'),
    }));
    const penv = { ...env, LCA_DATA_DIR: data, LCA_TMUX: 'none' };
    delete penv.LCA_WISPR_DIR;
    const live = (...a) => execFileSync(process.execPath, [path.join(ROOT, 'bin', 'live.mjs'), ...a], { env: penv, encoding: 'utf8' });
    const pidFile = path.join(data, 'phone-listener.pid');
    try {
      assert.match(live('on', 'call-notes'), /Started the phone listener/);
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      assert.doesNotMatch(live('on', 'call-notes'), /Started/);          // already running: not started twice
      process.kill(pid);
      for (let i = 0; i < 50 && fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(!fs.existsSync(pidFile), 'the listener removes its process id when it stops');
      assert.match(spawnSync(process.execPath, [path.join(ROOT, 'bin', 'live.mjs'), 'check'], { env: penv, encoding: 'utf8' }).stdout,
        /phone listener isn't running/);
    } finally {
      try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch {}
      live('off');
    }
  });

  await test('phone: when transcribing falls behind, it skips ahead to what is being said now', async () => {
    const data = path.join(tmp, 'phone-data-slow');
    const rec2 = path.join(tmp, 'recordings-slow');
    fs.mkdirSync(data);
    fs.mkdirSync(rec2);
    const earlier = path.join(rec2, 'Call earlier_250101_090000.m4a');   // lends its index, and is left alone
    fs.copyFileSync(sample, earlier);
    fs.utimesSync(earlier, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
    const slow = path.join(tmp, 'slow-whisper.mjs');
    fs.writeFileSync(slow, `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
await import(${JSON.stringify(pathToFileURL(path.join(tmp, 'fake-whisper.mjs')).href)});`);
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({
      source: 'phone', recordingsDir: rec2, whisperCli: slow, whisperModel: path.join(tmp, 'model.bin'),
      chunkSeconds: 1, maxLagSeconds: 2, languages: { simulated: 'fr' },
    }));
    const langLog = path.join(tmp, 'languages-slow.txt');
    const penv = { ...env, LCA_DATA_DIR: data, FAKE_LANG_LOG: langLog };
    delete penv.LCA_WISPR_DIR;
    const watcher = spawn(process.execPath, [path.join(ROOT, 'bin', 'phone.mjs')], { env: penv });
    let log = '';
    watcher.stdout.on('data', (d) => { log += d; });
    await new Promise((r) => setTimeout(r, 1500));
    spawnSync(process.execPath, [path.join(ROOT, 'bin', 'phone.mjs'), 'simulate', sample, rec2], { env: penv });
    for (let i = 0; i < 40 && !/call over/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
    watcher.kill();
    assert.match(log, /fell \d+s behind; skipping ahead/);
    // "languages" in the config: the contact's name is in the recording's name ("Call simulated_…").
    assert.ok(fs.readFileSync(langLog, 'utf8').trim().split('\n').every((l) => l === 'fr'));
    assert.match(log, /call over \(recording finished\)/);
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
