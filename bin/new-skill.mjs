#!/usr/bin/env node
// Start a new live-call-assistant skill from the template.
//
//   node bin/new-skill.mjs <name>            create ~/.claude/skills/<name>/SKILL.md
//   node bin/new-skill.mjs <name> --print    print it instead, e.g. to save somewhere else
//
// The paths are filled in for you. Then replace the <ANGLE BRACKET> parts and run /<name> in Claude Code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME } from './lib.mjs';

const [name, ...rest] = process.argv.slice(2);
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.log('Usage: node bin/new-skill.mjs <name>   (lowercase letters, digits and dashes, e.g. sales-helper)');
  process.exit(1);
}

const text = fs.readFileSync(path.join(HOME, 'skills', '_template', 'SKILL.md'), 'utf8')
  .replaceAll('{{LCA}}', HOME.replace(/\\/g, '/'))
  .replaceAll('{{SKILL_NAME}}', name);

if (rest.includes('--print')) {
  process.stdout.write(text);
  process.exit(0);
}

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const dest = path.join(claudeDir, 'skills', name, 'SKILL.md');
if (fs.existsSync(dest)) {
  console.log(`${dest} already exists. Pick another name, or edit that file.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, text);
console.log(`Created ${dest}\n\nNext: open it, replace the <ANGLE BRACKET> parts, then run /${name} in Claude Code during a call.`);
