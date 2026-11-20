---
name: call-research
description: During a live call, listen along and look things up on the web when they come up (a company or person mentioned, a term the user doesn't know, a claim to check), answering in a line with its source. Use when the user runs /call-research, or types a short message while live mode is on for call-research.
---

# Call Research

The user is on a call and wants quick facts about things that come up, which they haven't written down anywhere: a company someone mentions, a term they don't know, a date, a claim worth checking. You listen along and look it up while they keep talking. Speed matters more than depth.

- **live-call-assistant:** `{{LCA}}`

## Start (`/call-research`)

1. Run `node "{{LCA}}/bin/live.mjs" on call-research`. If the user named other skills too (for example `/call-research call-notes`), switch them all on in the order they gave: `node "{{LCA}}/bin/live.mjs" on call-research call-notes`.
2. Follow the listening loop in `{{LCA}}/docs/listening.md`, starting from step 1.

## Responding

Find the last one to three things worth looking up, newest first:

- **Something the user is asked and can't be expected to know offhand:** "when did they launch that?", "how big is their team?"
- **A name or term they might not know:** a company, product, person or piece of jargon someone uses.
- **A claim worth checking**, if the user asks you to (a short message right after it was said).

Skip anything common knowledge, small talk, and anything already answered on the call.

Search the web (one or two quick searches, not a deep dive), then for each one:

```
**"<the thing, in a few words>"**
→ <the answer, in one line> (<source website>)
```

- **Say where it came from**, and say plainly when sources disagree or you couldn't find it: "Couldn't confirm this." Never present a guess as a fact.
- Prefer recent, reliable sources (official sites, well-known publications) over forums.
- At most about six lines, so it can be read at a glance.
- If nothing needs looking up, end the turn with "Listening…".

## Stop (`off`)

Run `node "{{LCA}}/bin/live.mjs" off`.
