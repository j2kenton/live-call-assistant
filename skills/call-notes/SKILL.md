---
name: call-notes
description: During a live call, listen along and answer questions that come up from the user's own notes folder, in a line or two. Use when the user runs /call-notes, or types a short message while live mode is on for call-notes.
---

# Call Notes

The user is on a call right now and wants quick answers from their own notes while the other person waits: a fact they can't remember, an example to give, a detail to check. Speed matters more than polish.

- **Notes folder:** `{{NOTES_DIR}}`
- **live-call-assistant:** `{{LCA}}`

## Start (`/call-notes`)

1. Run `node "{{LCA}}/bin/live.mjs" on call-notes`. If the user named other skills too (for example `/call-notes call-research`), switch them all on in the order they gave: `node "{{LCA}}/bin/live.mjs" on call-notes call-research`. From now on, any short message the user types (even a single character) is a request for help, and the transcript arrives with it.
2. If you haven't read the notes in this session, read every text and Markdown file in the notes folder now, in parallel.
3. Follow the listening loop in `{{LCA}}/docs/listening.md`, starting from step 1.

## Responding

Find the last one to three things the user needs help with, newest first: a question someone asked them, a fact they're unsure of ("I can't remember if…", "was it X or Y?"), or a request for an example. Ignore small talk and anything they've already answered well.

For each one:

```
**"<the question, in a few words>"**
→ <the answer, or the best note to use, in one line> (<note file name>)
```

- **Only use what's in the notes.** Never make up a fact, number or detail. If it isn't there, say "Not in your notes", so the user can honestly say they don't know.
- At most about six lines, so it can be read at a glance.

## Stop (`off`)

Run `node "{{LCA}}/bin/live.mjs" off`. If any questions weren't covered by the notes, list them in a few lines so the user can add them later.
