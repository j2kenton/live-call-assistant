# On an Android phone

Live Call Assistant can also listen to the **phone calls on your Android phone**, using the phone's own call recording instead of Wispr Flow. Everything runs on the phone: the recording is turned into text on the phone itself by [whisper.cpp](https://github.com/ggml-org/whisper.cpp), and only that text reaches Claude, when you ask Claude Code for help.

It only works for **phone calls** that your phone records: not WhatsApp, Zoom or other app calls, which the phone's recorder doesn't record.

## How it works

1. Your phone records every call to an audio file (on Samsung phones: `Recordings/Call`).
2. `bin/phone.mjs`, running in Termux, notices a new recording and transcribes it in pieces of a few seconds **while the call is still going**. It writes the transcript in the same format Wispr Flow does, so the rest of Live Call Assistant (the hook, the skills, the listening loop) works exactly the same.
3. You use the skills in Claude Code as usual: `/call-notes`, then type any character when you need help.

The phone's recorder writes the audio as the call goes, but only writes the file's index (what a player needs to open it) when the call ends. `bin/m4a.mjs` gets around that by borrowing the index of an earlier recording from the same phone. So **live** transcription needs at least one earlier recorded call on the phone. Until then, and on phones that don't let other apps read the file until the call ends, you get the transcript as soon as the call is over instead.

## What you need

- **An Android phone that records calls automatically**, with the recordings in a folder you can see in the Files app. Samsung phones do (tested on a recent Galaxy). On many other phones, the Google Phone app keeps recordings where other apps can't reach them, so this won't work there.
- **[Termux](https://termux.dev/)**, from [F-Droid](https://f-droid.org/packages/com.termux/) or [GitHub](https://github.com/termux/termux-app/releases) (the Google Play version is outdated).
- **Claude Code running on the phone, in Termux.** The Claude app from Google Play isn't enough: its Code tab runs in the cloud and can't read files on your phone. See [Claude Code on the phone](#claude-code-on-the-phone).
- About 1 GB of free space, and a recent phone: transcribing takes real processing power.

No root and no ADB (USB or wireless debugging) needed.

## Set up

### 1. Turn on automatic call recording

On a Samsung phone: **Phone** app → **⋮** → **Settings** → **Record calls** → turn on **Auto record calls** (all calls, or chosen numbers). Then make one short call, so there's a recording to check the folder with, and to lend its index to live transcription (see above).

### 2. Install the transcription (in Termux)

```sh
pkg install -y git nodejs
git clone https://github.com/j2kenton/live-call-assistant.git
cd live-call-assistant
bash bin/setup-phone.sh
```

This installs ffmpeg, builds whisper.cpp in `~/whisper.cpp` (a few minutes), downloads a Whisper model, asks for storage access the first time, and sets `"source": "phone"` in `~/.live-call-assistant/config.json`. It ends by running `node bin/phone.mjs check`, which should say "All set".

**Choosing a model.** Transcription has to keep up with the call, so the model has to be fast enough for your phone. The default, `small`, is the one to start with. Measured on a Galaxy with a Snapdragon 8 Gen 3, with Termux on screen, transcribing 11 seconds of speech:

| Model | Size | Time for 11 s | Notes |
| :---- | :--- | :------------ | :---- |
| `small` | 470 MB | 5 s | Default. Keeps up comfortably. Fine for English; other languages readable, with some words spelled by sound |
| `large-v3-turbo-q5_0` | 550 MB | 12 s | Better for other languages, but only just as fast as speech, so it falls behind on that phone |

Install another with `bash bin/setup-phone.sh large-v3-turbo-q5_0`. The biggest model in `~/whisper.cpp/models` is used, unless you set `whisperModel` in the config (to use `small` once you have both, set it to `~/whisper.cpp/models/ggml-small.bin`, written out in full).

**Language.** Whisper is much faster, and more accurate, when it's told the language than when it has to detect it (on a phone, detecting takes longer than transcribing). So set the language your calls are usually in, with `"language"` (`"en"` by default; for example `"he"` for Hebrew), and it learns the language of each person you call. A first call with someone is transcribed in your default language. If you switch language during it (below), that's remembered for them; otherwise, when the call ends, the language it was in is detected (from its second half, so a recorded greeting doesn't count) and remembered. Their next call starts in that language. What's been learned is in `~/.live-call-assistant/phone-languages.json`; edit or delete entries to correct it. To fix someone's language in advance instead, add them to `"languages"` in the config: `{ "Dana": "en", "School": "he" }`. The names are checked against the recording's name, which on Samsung phones includes the contact's name. During a call, type the language to Claude Code (`English`, `he`, `switch to Hebrew`, `עברית`) and the rest of the call is transcribed in it; or run `node bin/phone.mjs language en`. With `"auto"`, the language is detected on the first words of each call and kept for the rest of it, which goes wrong when a recorded greeting is in another language.

### 3. Install into Claude Code

In the `live-call-assistant` folder:

```sh
node bin/install.mjs --notes ~/call-notes
```

That's the same installer as on a computer: it adds the hook and the example skills. Run it wherever Claude Code runs (see below).

## Use it

The same as on a computer ([README](../README.md#use-it)):

1. Start your call, with your phone recording it.
2. In Claude Code, run the skill, for example `/call-notes`. The first time, this also starts the phone listener (`bin/phone.mjs`), which transcribes calls as they're recorded and keeps running in the background after that, the way Wispr Flow does on a computer.
3. Whenever you need help, **type any character and press Enter**. A short hint works too.
4. When the call's over, type `off`.

`node bin/live.mjs check` shows whether the transcript can be read ("call in progress" and what's just been said), and warns if the listener isn't running. To start the listener yourself, for example so it's already running for your first call: `node bin/phone.mjs` in Termux. In Termux, running a skill starts it in a tmux session of its own (`tmux attach -t live-call-assistant` to see it), so it keeps going when you close Claude Code; its log is `~/.live-call-assistant/phone.log`.

You'll want headphones or the speakerphone, so you can read the screen while you talk.

**Keep Termux on screen during the call.** Android gives apps in the background much less processing power: on a Samsung phone, transcribing was 3 to 4 times slower with Termux in the background than on screen, which is too slow to keep up. With Claude Code open in Termux to read its help, it's on screen anyway. If transcribing does fall behind by more than 20 seconds, it skips ahead to what's being said now, since live help needs the latest words.

**After the call**, the transcript stays in `~/.live-call-assistant/phone-calls/<call>/live.ndjson`. You can ask Claude Code about it ("summarise my last call", "what did I promise to send?"); `node bin/transcript.mjs 3600` prints the last hour of the latest call. To transcribe an older recording, run `node bin/phone.mjs transcribe "<path to the recording>"`.

**Does your phone allow live?** Run `node bin/phone.mjs probe` (no Whisper needed) and make a short call. It logs the recording appearing and growing, and how many seconds of it can be read so far. If nothing shows up until you hang up, your phone keeps the recording hidden during the call, and you'll get transcripts after each call instead.

**Trying it without a call:** `node bin/phone.mjs simulate "<a finished recording>"` writes a copy of a recording into the recordings folder bit by bit, at the speed it was recorded, the way the phone does during a call. With the listener running, you'll see the transcript build up.

## Claude Code on the phone

Claude Code needs to run on the phone, in Termux, so it can read the transcripts. Two ways:

- **In Ubuntu inside Termux (how it's been tested).** Termux's `proot-distro` runs a small Ubuntu on the phone, without root, where Claude Code installs as on any Linux computer:

  ```sh
  pkg install -y proot-distro
  proot-distro install ubuntu
  proot-distro login ubuntu
  # now inside Ubuntu:
  apt update && apt install -y curl git nodejs
  curl -fsSL https://claude.ai/install.sh | bash
  claude
  ```

  Ubuntu has its own home folder (`/root`), so point it at the transcripts Termux writes. Inside Ubuntu, once:

  ```sh
  ln -s /data/data/com.termux/files/home/.live-call-assistant ~/.live-call-assistant
  ```

  Run the installer (step 3) inside Ubuntu, using the Termux path to this folder (`/data/data/com.termux/files/home/live-call-assistant`), Running a skill starts the phone listener in Termux itself, not in Ubuntu, so it keeps running when you leave Ubuntu (programs started inside `proot-distro login` stop then).

- **Directly in Termux (untested).** Claude Code is a Node.js program, so `npm install -g @anthropic-ai/claude-code` in Termux may work, and then nothing above is needed. If it doesn't, use Ubuntu.

## Configuration

These go in `~/.live-call-assistant/config.json`, with the settings from the [README](../README.md#configuration):

```json
{
  "source": "phone",
  "recordingsDir": "/sdcard/Recordings/Call",
  "whisperModel": "/data/data/com.termux/files/home/whisper.cpp/models/ggml-small.bin",
  "language": "en",
  "languages": { "School": "he" },
  "threads": 4,
  "chunkSeconds": 8,
  "maxLagSeconds": 20,
  "callLabel": "Call"
}
```

| Setting | Meaning |
| :------ | :------ |
| `source` | `"phone"` to read the phone's transcripts instead of Wispr Flow's. |
| `recordingsDir` | Where the phone saves call recordings, if it isn't found automatically. |
| `whisperCli`, `whisperModel` | whisper.cpp's `whisper-cli` and the model file, if they aren't in `~/whisper.cpp`. |
| `language` | The language of your calls: `"en"` (the default), `"he"`, …, or `"auto"` (slow; see [Language](#2-install-the-transcription-in-termux)). |
| `languages` | Languages for some contacts, overriding what's learned: `{ "part of the contact's name": "en" }`. |
| `threads` | CPU cores for transcribing. |
| `chunkSeconds` | How much new audio to collect before transcribing it. Shorter is more up to date; longer is a bit more accurate. |
| `maxLagSeconds` | If transcribing falls further behind than this (20 by default), it skips ahead to the latest audio. |
| `callLabel` | The label for transcript lines (see below). |

## Limitations

- **Phone calls only**, and only on phones whose recordings land in a folder Termux can read.
- **You and the other side aren't told apart.** The phone records both sides into one track, so every line is labelled `Call`. Claude works out who's speaking from what's said.
- **Live needs an earlier recording** to borrow its index from, and a phone that lets Termux read the file during the call. Otherwise the transcript arrives when the call ends.
- **Accuracy depends on the model and language.** Small models struggle with languages other than English, names and noisy lines.
- **It needs Termux on screen** to keep up (see [Use it](#use-it)). In the background it falls behind and skips ahead, so parts of the call are missed.
- **It uses the battery** while transcribing. Between calls, `phone.mjs` only checks the folder every two seconds.

## Privacy and consent

Recording calls is regulated: some places require everyone on the call to agree to it. Check the rules where you and the people you call are, and tell people their call is being recorded and transcribed. Recordings and transcripts stay on your phone; the transcript's text is sent to Claude only when you ask Claude Code for help.
