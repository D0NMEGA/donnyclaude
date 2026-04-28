Batch 2 extraction report
=========================

REQUESTED (4 videos):
  UHSy4klsFCw - Auto Claude - AI Coding on steroids                      (1h8m)
  3nPOaePP4Kk - Auto Claude - Improving our AI Coding system             (5h3m)
  v8C3N3AXv5o - Auto Claude - Vibe coding at the next level              (5h10m)
  nwjjN624HG0 - BMAD Method into Auto Claude                             (4h53m)

INCLUDED (1):
  nwjjN624HG0 - Had manual English captions from the original livestream.

MISSING (3): no transcript available from YouTube
  UHSy4klsFCw, 3nPOaePP4Kk, v8C3N3AXv5o

Why they failed:
  All three are recently-ended livestream recordings on André Mikalsen's
  channel. YouTube has not yet generated automatic captions (ASR) for them.
  `yt-dlp --list-subs` on each returns only `live_chat` — no `en` or other
  language captions in any format. This is not a yt-dlp/tooling issue; the
  captions simply do not exist on YouTube's side yet.

What to do:
  Option A — Wait. YouTube usually runs ASR on uploaded streams within a few
             days of the stream ending. Try re-running this request later.

  Option B — Transcribe audio locally with Whisper. This requires:
               - Installing mlx-whisper (fastest on Apple Silicon) or
                 openai-whisper, plus downloading the ~large model (~1.5 GB).
               - Downloading audio for the three videos (est. 300-500 MB total).
               - Running Whisper on them. On an M-series Mac with mlx-whisper,
                 figure roughly 0.1-0.3x realtime for the `large-v3` model,
                 so ~1-4 hours of wall-clock to transcribe ~11 hours of audio.
             Ask Claude Code to "install mlx-whisper and transcribe the three
             missing videos" if you want to go this route.

  Option C — Pipe the YouTube live_chat json through a chat log extractor.
             This is *not* a transcript of what was said, only what was typed
             in the chat, so it is generally not what you want.
