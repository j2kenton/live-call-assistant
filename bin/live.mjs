#!/usr/bin/env node
// Switch live mode on or off, and check the setup.
//
//   node bin/live.mjs on <skill> [more skills]   live mode on: short messages become requests for those
//                                                 skills (in priority order, e.g. on call-notes call-research)
//   node bin/live.mjs off          live mode off
//   node bin/live.mjs status       is it on, and for which skills?
//   node bin/live.mjs check        can the transcript be read right now?
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { BIN, STATE_FILE, clearState, config, phoneListenerPid, readState, startPhoneListener, writeState } from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case 'on': {
    const skills = [...new Set(rest.map((s) => s.replace(/^\//, '')).filter(Boolean))];
    if (!skills.length) {
      console.log('Usage: node bin/live.mjs on <skill> [more skills]');
      process.exit(1);
    }
    writeState({ skills, startedAt: new Date().toISOString() });
    console.log(`Live mode ON for ${skills.map((s) => `/${s}`).join(', ')} ` +
      `(switches off by itself after ${config().maxAgeHours} hours).`);
    if (config().source === 'phone') {         // on a phone: make sure calls are being transcribed
      const started = startPhoneListener();
      if (started) console.log(started);
    }
    break;
  }
  case 'off':
    clearState();
    console.log('Live mode OFF.');
    break;
  case 'status': {
    const s = readState();
    const list = s && (s.skills || [s.skill]).map((n) => `/${n}`).join(', ');
    console.log(s ? `Live mode ON for ${list} since ${s.startedAt} (${STATE_FILE})` : 'Live mode is off.');
    break;
  }
  case 'check':
    if (config().source === 'phone' && !phoneListenerPid()) {
      console.log('The phone listener isn\'t running, so calls aren\'t being transcribed. Running a skill starts it, ' +
        `or start it in Termux: node ${path.join(BIN, 'phone.mjs')}`);
    }
    try {
      process.stdout.write(execFileSync(process.execPath, [path.join(BIN, 'transcript.mjs'), '60'], { encoding: 'utf8' }));
    } catch (e) {
      process.stdout.write(e.stdout || e.message);
      process.exit(1);
    }
    break;
  default:
    console.log('Usage: node bin/live.mjs on <skill> [more skills] | off | status | check');
    process.exit(1);
}
