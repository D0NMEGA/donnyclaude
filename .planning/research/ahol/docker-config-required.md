# Docker Desktop Resource Configuration Required

Generated: 2026-04-23 UTC
Purpose: Tune Docker Desktop resource limits before AHOL D1 spike, sized for 5 parallel SWE-bench Lite variant containers on a 2018 MBP (i7-8750H, 16 GB host RAM, T2 chip).

## Current allocation (snapshot from `docker info`)

| Setting | Current value | Target | Action |
|---|---|---|---|
| CPUs | 12 (all host logical cores) | 4 | REDUCE: leaves 2 logical cores for macOS UI + Claude Code orchestration |
| Total Memory | 7.752 GiB (~half of 16 GB host) | 10 GB | INCREASE: gives parallel containers headroom without paging the host |
| Swap | unknown from CLI | 2 GB | SET if not already 2 GB |
| Disk image size | unknown from CLI | ≥ 80 GB | VERIFY: SWE-bench Lite repo containers are large; running out mid-spike causes silent test failures |

Server version 29.4.0, overlayfs storage driver, cgroup v2. All current and supported.

## Why these targets, on this hardware

- **CPUs at 4 (not 6)**: The host has 6 physical cores (12 logical with hyperthreading). Docker Desktop can saturate all logical cores by default, but when 5 parallel SWE-bench Lite containers each pin a worker thread, macOS UI and the Claude Code parent loop get starved, and the entire spike clock-time inflates from oversubscription. 4 logical cores for Docker, 2 for the host, gives clean parallelism without contention.
- **Memory at 10 GB (not 12 GB)**: At 16 GB host RAM, leaving 6 GB for macOS plus running apps prevents swap thrash. SWE-bench Lite containers each peak around 1.5 to 2 GB resident; 10 GB supports 5 parallel containers with margin.
- **Swap at 2 GB**: Floor for occasional spikes. Setting higher invites Docker to use it, which on a non-NVMe SATA SSD (the 2018 MBP storage tier) is significantly slower than RAM and tanks per-task latency.
- **Disk image at 80 GB minimum**: SWE-bench Lite per-task containers can be 1 to 4 GB each; 11 unique repos plus image layers easily reaches 40 to 60 GB on disk. 80 GB target leaves room for image cache reuse across runs without forced eviction.

## Manual configuration steps (Docker Desktop has no CLI for these)

1. Click the Docker Desktop icon in the macOS menu bar.
2. Select "Settings" (gear icon).
3. Navigate to "Resources" > "Advanced".
4. Set CPUs slider to **4**.
5. Set Memory slider to **10 GB** (10240 MB).
6. Set Swap slider to **2 GB** (2048 MB).
7. Set Disk image size slider to **80 GB** minimum.
8. Click "Apply & Restart". Docker Desktop will restart with the new limits.

## Verification after apply

After restart, run:
```bash
docker info 2>&1 | grep -iE "cpus|memory"
```
Expected output:
```
 CPUs: 4
 Total Memory: 9.313GiB    (10 GB allocated minus Docker engine overhead)
```

Memory may show ~9.3 GiB rather than exactly 10 GiB; that is normal Docker Desktop overhead.

## Confirmation back to me

When Docker Desktop reports `CPUs: 4` and `Total Memory: ~9.3GiB`, reply "Docker tuned" and the spike will proceed. Until then, AHOL D1 spike runs are paused at the resource-limit gate.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
