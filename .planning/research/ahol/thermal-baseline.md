# Thermal Baseline Capture (pre-spike)

Generated: 2026-04-23 UTC
Method: `sudo powermetrics --samplers smc,cpu_power -n 1 -i 1` against idle-with-browser-and-Claude-Code workload.
Macs Fan Control status: running, PID 27313, custom CPU Proximity curve active (per `.planning/research/ahol/thermal-setup.md`).

## Captured snapshot

| Metric | Value |
|---|---|
| Hardware | MacBookPro15,1 (2018 15-inch, i7-8750H, 16 GB) |
| Boot time | Tue Apr 21 02:16:05 2026 (~2 days uptime) |
| CPU die temperature | 43.84 C |
| GPU die temperature | 35.00 C |
| Fan RPM | 5466.72 |
| CPU Thermal level | 50 |
| GPU Thermal level | 50 |
| IO Thermal level | 50 |
| Package power (CPUs + GT + SA) | 19.65 W |
| CPU average frequency | 3706.12 MHz (168.46% of 2.2 GHz nominal) |
| CPU Plimit | 0.00 (no throttle ceiling engaged) |
| GPU Plimit (internal) | 0.00 |
| Number of prochots | 0 (no thermal throttle events in this sample) |
| Cores Active | 77.61% |
| Avg Num of Cores Active | 1.53 (moderate concurrency) |
| Package 0 C-state residency | 0.00% across all C-states (package pinned active) |

## Interpretation

- Both CPU and GPU well under any throttle threshold (2018 MBP i7-8750H starts thermal throttling around 95 C). 43.84 C is cool baseline, consistent with a lightly-loaded system and Macs Fan Control's aggressive curve keeping the die cold even at idle.
- Fan at 5466 rpm is near the top of this chassis's range (max around 6000 rpm). This is the Macs Fan Control curve acting preemptively; audible but intentional per the thermal-setup.md strategy (prioritize sustained performance over silence during spike runs).
- Zero prochots, Plimit 0.00, and CPU boosting 68% above nominal confirm the chip is not thermally constrained in this state. Any throttling observed during the spike will be attributable to spike workload, not pre-existing thermal headroom issues.

## Spike-run go/no-go thermal thresholds

| CPU die temp during run | Verdict |
|---|---|
| < 85 C | **GREEN**: spike runs have full thermal budget |
| 85 to 92 C | **AMBER**: approaching Plimit territory, watch prochots |
| > 92 C or prochots > 0 | **RED**: thermal throttling active, run variance no longer purely algorithmic; restart with fan ramp or reduce Docker CPU count |

## Re-capture protocol during spike

Recommend `sudo powermetrics --samplers smc,cpu_power -n 1 -i 1 | grep -E 'die temperature|Fan|prochots|Plimit'` at four points per run:
1. Pre-run (cold baseline)
2. Mid-run (task 5 of 10)
3. Post-run (immediately after completion, before cooldown)
4. Cooldown (5 min after post-run)

Log each capture as an appendix to `spike-results.md`. This isolates the thermal contribution to run-to-run sigma. If the same 10 tasks produce different scores across runs, thermal variation is one possible noise source.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
