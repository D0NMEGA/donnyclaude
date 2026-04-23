# Q11 Investigation: Claude Max 5-hour Reset Detection

Generated: 2026-04-23 UTC
Purpose: Determine the detection mechanism D5 (calendar scheduler) uses to know when a Claude Max usage window resets, so AHOL kicks off the next variant batch at the right moment.
Investigation order per user directive: (a) parse local state file, (b) probe via claude --print, (c) hardcode 5-hour cron.

## Option (a): Parse local state file

**Method**: `ls -la ~/.claude/` plus `find ~/.claude -maxdepth 3 -name "*usage*" -o -name "*rate*" -o -name "*quota*" -o -name "*reset*"`.

**Result**: No files matching usage, rate, quota, or reset patterns exist in `~/.claude/` or any subdirectory up to depth 3. Hits in the find output (`commands/orchestrate.md`, `skills/strategic-compact`, `.opencode/commands/orchestrate.md`) match the patterns lexically but contain no usage-window metadata.

**Verdict: NOT VIABLE.** Claude Code 2.1.117 does not persist usage state to a known local file path. If a future Claude Code version adds one, revisit option (a) first since it is the cheapest and most accurate detection path.

## Option (b): Probe via claude --print and capture rate-limit metadata

**Method**: `claude --print --model opus "ping"`, capture exit code, response text, and any visible rate-limit signal.

**Result**: 
```
Exit: 0
Wall: 12s
Response: pong
```

The probe succeeds and returns a normal response. No rate-limit metadata is exposed in stdout or in the exit code. Claude Code's `--print` mode does not surface HTTP response headers (which are where rate-limit data normally lives in the underlying Anthropic API). 

**Sub-verdict**: Option (b) WORKS as a healthcheck (probe succeeds = window has capacity, probe fails with exit 1 + rate-limit error text = window is exhausted), but does NOT expose forward-looking metadata (when does the window reset?). It is a lagging indicator.

**Refinement**: a watchdog pattern using option (b) can detect window exhaustion the moment it happens (probe fails) and infer the next reset by adding 5 hours to the failure timestamp. This works but accumulates clock drift over many cycles. Acceptable for a calendar scheduler with a small tolerance band.

**Verdict: PARTIALLY VIABLE as a watchdog**, not as a forward-looking prediction.

## Option (c): Hardcode 5-hour cron interval

**Method**: `which crontab` to confirm cron is available; rely on cron to fire every 5 hours starting from a known anchor moment.

**Result**: `/usr/bin/crontab` exists. cron is available. macOS launchd is the preferred scheduler on this platform but cron remains supported.

**Verdict: VIABLE.** A launchd plist or crontab entry firing every 5 hours starting from the user's first AHOL kick-off captures the window reset cycle. Drift is bounded because the reset is itself on a ~5-hour schedule from the first usage event of the window.

## Recommended D5 design

Hybrid (b) plus (c):

1. Use launchd or cron to schedule the AHOL run-cycle every 5 hours, starting from the user's first manual AHOL kick-off.
2. Before each cycle, run a probe (`claude --print --model opus "ping"`) to verify the window is open. Exit code 0 = proceed; non-zero = log and reschedule for the next interval.
3. If the watchdog probe fails when the cycle was supposed to fire, record the timestamp and reset the cycle anchor to that moment + 5 hours. This corrects drift if the user's actual reset time slips relative to the cron anchor.
4. Optional: persist the last-known window-open timestamp to `.planning/research/ahol/.usage-anchor` for resume-after-machine-restart resilience.

## launchd plist sketch

Pattern (do not implement during spike):
```xml
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.donnyclaude.ahol.scheduler</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/donmega/Desktop/donnyclaude/scripts/ahol-scheduler.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>18000</integer> <!-- 5 hours in seconds -->
  <key>StandardOutPath</key>
  <string>/tmp/ahol-scheduler.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/ahol-scheduler.err</string>
</dict>
</plist>
```

The shell script `scripts/ahol-scheduler.sh` runs the watchdog probe, decides go/no-go, and on go invokes the AHOL runner.

## Open follow-ups

- Validate option (b) probe behavior when the window is actually exhausted. Today's investigation only tested the open-window path. The closed-window failure mode (exit code, error text format) is still untested. Capture that next time the user hits a real rate-limit.
- Investigate whether Claude Code 2.2 or later exposes a usage state file. If it does, revert to pure option (a).

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
