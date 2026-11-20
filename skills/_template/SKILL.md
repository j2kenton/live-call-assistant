---
name: {{SKILL_NAME}}
description: During a live call, <WHAT THIS SKILL DOES, IN ONE SENTENCE>. Use when the user runs /{{SKILL_NAME}}, or types a short message while live mode is on for {{SKILL_NAME}}.
---

<!--
  A template for your own live-call-assistant skill.

  Easiest: run `node bin/new-skill.mjs <name>` in the live-call-assistant folder. It copies this file to
  ~/.claude/skills/<name>/SKILL.md with the paths filled in. Then replace everything in <ANGLE BRACKETS>,
  delete this comment, and run /<name> in Claude Code during a call.

  Or ask Claude Code to do it for you, for example:
    "Create a live-call-assistant skill called sales-helper from the template in
     <path>/skills/_template/SKILL.md. During sales calls it should listen for customer objections
     and suggest a short reply from my notes in ~/sales-notes."

  The listening itself (reading the transcript, waiting in the background, coping with lag and split
  sentences) is handled by docs/listening.md. This file only says what to listen for and how to respond.
-->

# <SKILL TITLE>

<WHAT'S GOING ON: who the user is talking to, what kind of help they want, and how fast. For example: "The user is on a sales call and wants a quick reply when the customer raises an objection.">

- **live-call-assistant:** `{{LCA}}`
- <ANYTHING ELSE THE SKILL NEEDS, e.g. **Notes folder:** `~/my-notes`. Delete this line if there's nothing.>

## Start (`/{{SKILL_NAME}}`)

1. Run `node "{{LCA}}/bin/live.mjs" on {{SKILL_NAME}}`. From now on, any short message the user types (even a single character) is a request for help, and the transcript arrives with it.
2. <OPTIONAL SETUP, e.g. "Read every file in the notes folder now, in parallel." Delete this step if there's nothing.>
3. Follow the listening loop in `{{LCA}}/docs/listening.md`, starting from step 1.
   <OPTIONAL: to suggest things without being asked (like /call-jokes), add: "Wait with `--min 45` added, and keep listening until the user says off or three waits in a row return nothing new.">

## Responding

<WHAT TO LISTEN FOR: the moments when the user needs help. For example: a question they've been asked, a customer objection, a name they've forgotten.>

<HOW TO RESPOND, with the exact format. Keep it short enough to read at a glance during a call. For example:>

```
**"<the moment, in a few words>"**
→ <the suggestion, in one line>
```

- <RULES, e.g. "Only use what's in the notes; if it isn't there, say so." or "Keep it kind and playful.">
- If there's nothing worth saying, end the turn with "Listening…" so the user isn't distracted.

## Stop (`off`)

Run `node "{{LCA}}/bin/live.mjs" off`. <OPTIONAL WRAP-UP, e.g. "List anything the notes didn't cover.">
