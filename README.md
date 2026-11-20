# Live Call Assistant

Let [Claude Code](https://claude.com/claude-code) listen along to your calls and help in real time.

You're on a call and someone asks you something you can't quite remember. Instead of typing out the question while they wait, you type a single key. Claude reads the last few minutes of the conversation, works out what you were just asked, and answers from your own notes in a line or two. It keeps listening for a few minutes in case the rest of the question is still on its way.

It works with any kind of call, and each use is a short **skill** on top of the same listening engine. Two come included:

| Skill | What it does |
| :---- | :----------- |
| `/call-notes` | Answers questions that come up on the call from a folder of your own notes. Never makes things up: if it isn't in your notes, it says so. |
| `/call-jokes` | Listens to a casual call (family, friends) and now and then suggests a funny line you could say. |

Writing your own takes a few minutes: see [Make your own skill](#make-your-own-skill).

## How it works

[Wispr Flow](https://wisprflow.ai/) transcribes your calls and writes the transcript to a file on your computer *while the call is still going*, a few seconds behind speech, with your microphone and the other side labelled separately. Live Call Assistant reads that file:

1. You switch on **live mode** for a skill.
2. Whenever you type a short message (any character will do), a Claude Code hook attaches the latest transcript before Claude even sees your message, so the answer comes back quickly.
3. Claude answers, then keeps listening in the background and answers new questions as they arrive.

Everything stays on your computer apart from what Claude Code itself sends to Claude.

## Requirements

- **[Claude Code](https://claude.com/claude-code)**, running on the same computer as the call: in a terminal, in VS Code, or in the Code tab of the Claude desktop app. (Claude on the web can't read files on your computer.)
- **[Wispr Flow](https://wisprflow.ai/)** with meeting transcription, recording the call.
- **[Node.js](https://nodejs.org/) 18 or later.**
- **Windows** is tested. macOS should work but is untested: if your Wispr Flow meetings folder isn't found, set it in the [config](#configuration).

## Install

```sh
git clone https://github.com/j2kenton/live-call-assistant.git
cd live-call-assistant
node bin/install.mjs --notes "/path/to/your/notes"
```

The installer:

- adds one hook to your Claude Code settings (`~/.claude/settings.json`), after backing them up, and
- installs the two example skills into `~/.claude/skills/`, pointing at this folder.

Then restart Claude Code (or open `/hooks` once) so it picks up the hook.

Options: `--no-hook`, `--no-skills`, `--force` (overwrite skills you've already installed), and `--uninstall` (removes the hook and the example skills again).

<details>
<summary>Prefer to add the hook by hand?</summary>

Add this to `~/.claude/settings.json`, using the full path to this folder:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"/path/to/live-call-assistant/bin/hook.mjs\"", "timeout": 15 }] }
    ]
  }
}
```

The hook does nothing at all unless live mode is on.
</details>

## Use it

1. Start your call, with Wispr Flow recording it.
2. Check that the transcript can be read: `node bin/live.mjs check`. You should see "call in progress" and what's just been said.
3. In Claude Code, run the skill, for example `/call-notes`.
4. Whenever you need help, **type any character and press Enter**. A short hint works too, like `pricing` or `another example`.
5. When the call's over, type `off`.

Live mode switches itself off after four hours, in case you forget.

### Tips

- **Wear headphones.** If Claude's replies are read aloud through speakers, your microphone picks them up and they end up in the transcript.
- **Type as soon as you hear the question.** You don't have to wait for the transcript to catch up: Claude keeps listening for the rest.
- **Start a fresh Claude Code session for each call.** A short session keeps answers fast.

## Configuration

Optional. Create `~/.live-call-assistant/config.json` with any of these:

```json
{
  "wisprDir": "C:/Users/you/AppData/Roaming/Wispr Flow/meetings",
  "settleSeconds": 4,
  "maxAgeHours": 4,
  "shortMessageChars": 60,
  "youLabel": "You",
  "themLabel": "Them"
}
```

| Setting | Meaning |
| :------ | :------ |
| `wisprDir` | Wispr Flow's meetings folder, if it isn't found automatically. |
| `settleSeconds` | How long a pause in speech ends a chunk of new speech. |
| `maxAgeHours` | Live mode switches itself off after this long. |
| `shortMessageChars` | Messages up to this length count as "help me now". Longer ones are treated as normal requests. |
| `youLabel`, `themLabel` | Labels for your microphone and the other side of the call. |

Your settings and live-mode state live in `~/.live-call-assistant/`, outside this folder, so nothing personal ends up in the repo.

## Make your own skill

A skill is a `SKILL.md` file in `~/.claude/skills/<name>/`. Start from the template:

```sh
node bin/new-skill.mjs sales-helper
```

This creates `~/.claude/skills/sales-helper/SKILL.md` from [skills/_template/SKILL.md](skills/_template/SKILL.md), with the paths filled in. Open it, replace the parts in `<ANGLE BRACKETS>` (what to listen for, and how to respond), and run `/sales-helper` in Claude Code during a call. Add `--print` to print the skill instead of saving it.

**Or let Claude Code write it for you.** Paste something like this into Claude Code, using the real path to this folder:

> Create a live-call-assistant skill called sales-helper from the template in `/path/to/live-call-assistant/skills/_template/SKILL.md`. During sales calls it should listen for customer objections and suggest a short reply from my notes in `~/sales-notes`. Save it to `~/.claude/skills/sales-helper/SKILL.md`.

Every skill does three things:

1. **Start:** run `node "/path/to/live-call-assistant/bin/live.mjs" on <name>`.
2. **Listen:** follow the loop in [docs/listening.md](docs/listening.md). It explains how to answer, keep listening in the background, and cope with sentences that arrive in pieces. Your skill doesn't need to repeat any of it.
3. **Respond:** this is the part that's yours. Say what to listen for in the conversation and how to answer.

The two example skills, [call-notes](skills/call-notes/SKILL.md) and [call-jokes](skills/call-jokes/SKILL.md), are short, working skills to copy from. In the repo they contain `{{LCA}}` and `{{NOTES_DIR}}` placeholders, which the installer fills in. If you copy one by hand, replace `{{LCA}}` with the full path to this folder (forward slashes work on Windows too).

## Commands

| Command | What it does |
| :------ | :----------- |
| `node bin/live.mjs on <skill>` | Switch live mode on for a skill. |
| `node bin/live.mjs off` | Switch it off. |
| `node bin/live.mjs status` | Show whether it's on. |
| `node bin/live.mjs check` | Show the last minute of the call's transcript. |
| `node bin/new-skill.mjs <name>` | Start a new skill from the template. |
| `node bin/transcript.mjs [seconds]` | Print the last N seconds of the transcript (default 300). |
| `node bin/transcript.mjs --wait 120 --after N` | Wait for new speech after line N. See [docs/listening.md](docs/listening.md). |

## Limitations

- **This isn't an official Wispr Flow integration.** It reads files Wispr Flow keeps on your computer, and a Wispr update could change their format.
- **Answers lag a little.** Wispr writes the transcript a few seconds behind speech, and Claude needs a few seconds to answer.
- **Remote speakers aren't told apart.** Everyone except you is labelled "Them".

## Privacy and consent

This tool works from a transcript of your calls. Make sure everyone on the call knows it's being transcribed, and follow the rules that apply where you are. Don't use it where outside help isn't allowed, such as a real job interview or an exam.

## License

[MIT](LICENSE)
