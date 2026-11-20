# The listening loop

How a skill keeps listening to a call and responds as things are said. Every skill built on live-call-assistant follows these rules; the skill itself only decides *what* to say.

`<LCA>` below means the folder where live-call-assistant is installed.

## Why it works this way

- **The transcript lags behind speech.** Wispr Flow writes the transcript a few seconds after words are spoken, so a question often isn't there yet when the user asks for help. So the skill answers what's there now, then keeps listening for what's still coming.
- **Answers must end a turn.** Some Claude Code views (VS Code, for example) fold text written between tool calls into a collapsed row until the turn is over. An answer followed by more tool calls may never be seen. So the waiting happens in the background, and each answer is the last thing in its turn.
- **Sentences arrive in pieces.** Wispr breaks a sentence wherever the speaker pauses: "tell me about a time where you—", then "had to give feedback to a colleague".

## The loop

1. **Respond to what's there.** If the hook attached a transcript, use it. Otherwise run `node "<LCA>/bin/transcript.mjs" 300`. Respond following your skill, or write "Listening…" if there's nothing to respond to yet. Note the `# cursor N` at the end of the output.
2. **Wait in the background.** Start `node "<LCA>/bin/transcript.mjs" --wait 120 --after N` with the Bash tool and `run_in_background: true`. Always pass the latest cursor as `--after`, or lines that land between two waits are missed. Then **end your turn**, with your answer (or "Listening…") as the last thing you write.
3. **When the wait finishes, you're woken up.** Read its output: the new speech, the `(before)` line for context, and a new cursor.
   - If the new speech is an unfinished sentence (it ends with "—" or stops mid-thought), don't respond yet. Start the next wait.
   - If there's something to respond to, respond, in the same turn as starting the next wait, with your response last.
   - If there's nothing worth saying, start the next wait and end the turn with a short status like "Listening…".
4. **Repeat until** a wait returns "nothing new", the skill's own time limit is reached, the output says the call changed or ended, or the user says "off".

## Several skills at once

Live mode can run several skills together, for example `node "<LCA>/bin/live.mjs" on call-notes call-research`. The order is the priority order.

- **Listen once.** Use a single listening loop for all of them. If any active skill answers questions (like call-notes or call-research), wait without `--min`, so questions get answered quickly, even if another skill (like call-jokes) normally waits longer.
- **Answer from the first skill that can.** For each thing that needs a response, try the skills in order: for example, answer from the notes if they cover it, and only search the web if they don't. Say which source an answer came from.
- **One combined response.** Put everything in a single reply, still at most about six lines.
- **Playful skills come last.** Only suggest a joke when nothing else needs answering.
- **Stopping:** "off" (or any active skill's name followed by "off") switches them all off.

## Output of `transcript.mjs`

```
# call in progress, last written 3s ago
[14:05:00] You: So, tell me about a time where you—
[14:05:09] Them: Had to give feedback to a colleague.
# cursor 42
```

- `You` is the user's microphone. `Them` is everyone else on the call (Wispr doesn't tell remote speakers apart). Both labels can be changed in the config.
- If the user listens to Claude's replies through speakers, their microphone may pick them up as `You` lines. Ignore anything that reads like your own earlier answers, and suggest headphones.
