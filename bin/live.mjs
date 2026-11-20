#!/usr/bin/env node
// Switch live mode on or off, and check the setup.
//
//   node bin/live.mjs on <skill>   live mode on: short messages become requests for /<skill>
//   node bin/live.mjs off          live mode off
//   node bin/live.mjs status       is it on, and for which skill?
//   node bin/live.mjs check        can the transcript be read right now?
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { BIN, STATE_FILE, clearState, config, readState, writeState } from './lib.mjs';

const [cmd, skill] = process.argv.slice(2);

switch (cmd) {
  case 'on': {
    if (!skill) {
      console.log('Usage: node bin/live.mjs on <skill-name>');
      process.exit(1);
    }
    const name = skill.replace(/^\//, '');
    writeState({ skill: name, startedAt: new Date().toISOString() });
    console.log(`Live mode ON for /${name} (switches off by itself after ${config().maxAgeHours} hours).`);
    break;
  }
  case 'off':
    clearState();
    console.log('Live mode OFF.');
    break;
  case 'status': {
    const s = readState();
    console.log(s ? `Live mode ON for /${s.skill} since ${s.startedAt} (${STATE_FILE})` : 'Live mode is off.');
    break;
  }
  case 'check':
    try {
      process.stdout.write(execFileSync(process.execPath, [path.join(BIN, 'transcript.mjs'), '60'], { encoding: 'utf8' }));
    } catch (e) {
      process.stdout.write(e.stdout || e.message);
      process.exit(1);
    }
    break;
  default:
    console.log('Usage: node bin/live.mjs on <skill> | off | status | check');
    process.exit(1);
}
