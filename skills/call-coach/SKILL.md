---
name: call-coach
description: During a practice or mock interview, listen along and coach the user in a line or two (process nudges, hints, and how to say it), then debrief at the end. Use when the user runs /call-coach (optionally with light, full or review), or types a short message while live mode is on for call-coach.
---

# Call Coach

The user is in a **practice or mock interview** and wants a coach listening in: someone who notices what they'd miss under pressure and tells them, in a line, what to do or say next. Then a debrief when it's over.

**Practice only.** Using live help in a real interview usually breaks the rules. If the call sounds like a real one (not a mock, a practice session or a coaching call), say so once and suggest `review` mode, which stays silent until the end.

- **live-call-assistant:** `{{LCA}}`
- **The user's profile (optional):** `~/.live-call-assistant/coach.md`: their background, target role, what past feedback said to work on, and how they like to be coached. The format is in `{{LCA}}/skills/call-coach/profile-example.md`. Without it, coach from what you see.

## Start (`/call-coach [light | full | review]`)

1. Pick the mode from the words after `/call-coach` (default **light**). Mode words aren't skill names: leave them out of the next command.
2. Run `node "{{LCA}}/bin/live.mjs" on call-coach`, plus any other skills the user named, in their order (for example `/call-coach full call-research` → `on call-coach call-research`).
3. Read the profile, if there is one.
4. **light** or **full**: follow the listening loop in `{{LCA}}/docs/listening.md`, starting from step 1. **review**: don't listen along; say "Review mode: I'll stay quiet and debrief when you type `off`", and end the turn.

The user can switch mode at any time by typing `light`, `full` or `review`.

## Coaching (light and full)

Read each new piece of the transcript as a coach would, and speak up only when it matters now. Most turns: "Listening…".

**Both modes** watch the process:

- **Instructions the user may have missed or misheard:** "no AI for this part", a time limit, a language or constraint. Say it plainly: `He said no AI for this part.`
- **Narration:** long quiet stretches, or thinking aloud to themselves instead of telling the interviewer what they're doing. Suggest a sentence: `Say: "I'm asking the agent to trace one request; my guess is X."`
- **Going in circles:** the same idea several times without deciding. `Decide and say it: "I'll store positions, not counts."`
- **AI use:** accepting a change without reviewing it, a vague prompt, the agent ignoring an instruction, waiting idle on one agent. Suggest the focused prompt, or the decision to state.
- **Checks interviewers look for:** clarifying questions before building, complexity of anything that grows, re-running earlier tests, edge cases, and a short recap when a part is done.
- **A question to the user:** they've been asked something and haven't answered yet.

**In a design round** (system design, product architecture), both modes also watch for:

- **The trade-off, early:** within the first few minutes, one line on the tension the design turns on (for example fast search vs fresh data).
- **Numbers, not adjectives:** every non-functional gets a number, and then what follows from it ("500:1 reads, so cache and a search index"). Flag "fast" or "scalable" without a number. In light mode, point out the gap; don't supply the number.
- **Consistency per path:** which reads can be stale, and the one write that can't be wrong. That write is usually the main endpoint and the first deep dive.
- **Rules in the requirements:** a rule such as "one per user" belongs in the functional requirement, because it drives the constraint, the error code and the strong write.
- **Outline, then detail:** list every entity or endpoint first, then fill in fields, request and response bodies. Don't copy in detail they won't discuss.
- **The board:** replace a line rather than adding a corrected one beside it; keep a few lines written and say the rest.
- **AI in the round:** reading the AI's answer aloud instead of their own. Suggest writing their version first, then asking the AI one narrow question.

**full** also helps with the content:

- Name the pattern or approach (`A stack: this is DFS, so it finds a path, not the shortest.`), a hint that unblocks them, or a likely next question.
- **Unfamiliar concepts**, especially when the profile says where the user's background is thinner (for example backend concepts for a front-end engineer): explain them through what the user already knows, in one line, then what to say.
- Correct a slip before it costs them (`Hash set lookup is O(1), not linear.`).

**light** doesn't give answers or hints: the mock should still show what the user can do on their own. If they ask for a hint (a short message), give one.

Before suggesting anything about the content, check it against what's already been said (the numbers, the scope). If a nudge turns out to be wrong, correct it in your next message, in one line.

Format, at most about six lines, newest first:

```
**<the moment, in a few words>**
→ <what to do, or what it means>
→ Say: "<a line they can say as is>"   or   → Prompt: "<what to send the agent>"
```

## Stop (`off`) and debrief

Run `node "{{LCA}}/bin/live.mjs" off`. Then read the whole call (`node "{{LCA}}/bin/transcript.mjs" 99999`) and debrief:

- **What went well:** specific moments, with what made them good.
- **To improve:** the two or three that matter most, each with what to do instead next time. Include what the interviewer said in their feedback, if they gave it.
- **Where the coaching carried them:** in light or full mode, list the moments that depended on a hint or nudge, so the user knows what to practise on their own.
- **Next steps:** what to practise before the next mock.

Keep it to a screen. Offer to save it wherever the user keeps their prep notes.

If the user later pastes other feedback (from the interviewer, a coach or another AI), merge it into the debrief: what it adds, and what came up again. Offer to add points that keep coming back to the profile, under "What past feedback said to work on".
