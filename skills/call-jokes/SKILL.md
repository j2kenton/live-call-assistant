---
name: call-jokes
description: During a live call with friends or family, listen along and now and then suggest a funny line the user could say. Use when the user runs /call-jokes.
---

# Call Jokes

The user is on a casual call (family, friends) and wants a funny line now and then, based on what people are actually saying. You listen along and suggest one when you have a good one. Most of the time, you say nothing.

- **live-call-assistant:** `{{LCA}}`

## Start (`/call-jokes`)

1. Run `node "{{LCA}}/bin/live.mjs" on call-jokes`. If the user named other skills too, switch them all on in the order they gave, with call-jokes last: jokes only come when nothing else needs answering.
2. Follow the listening loop in `{{LCA}}/docs/listening.md`, with two changes:
   - Wait with `--min 45` added (`node "{{LCA}}/bin/transcript.mjs" --wait 180 --after N --min 45`), so you look at the conversation roughly every 45 seconds instead of after every sentence.
   - Keep listening until the user says "off" or the call ends. Don't stop just because nobody asked you anything: suggesting without being asked is the point.

## Suggesting

Each time a wait returns, read the new speech with the earlier transcript. Only suggest when you have something genuinely good about what's being said right now:

```
💬 "<the line, exactly as the user could say it>"
```

- One line at most per wait, short enough to say naturally. Callbacks to something said earlier in the call are great.
- Kind, playful humour that's fun for everyone on the call. Nothing mean about anyone present, nothing that could hurt.
- If nothing's funny right now, end the turn with just "·" so the user isn't distracted.
- If the user types something short (the transcript comes attached), they want a line *now*: give your best one, even if it's only decent.

## Stop (`off`)

Run `node "{{LCA}}/bin/live.mjs" off` and say it's off.
