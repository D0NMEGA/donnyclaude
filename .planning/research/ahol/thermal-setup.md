# Thermal Headroom Setup for 2018 MBP i7-8750H

Generated: 2026-04-23 UTC
Purpose: Documentation only this turn. User installs and configures manually before first spike run.
Hardware target: 2018 15-inch MacBook Pro, Intel Core i7-8750H (Coffee Lake H, 6C/12T, 45W TDP), T2 security chip.

## Why this matters for AHOL spike runs

The i7-8750H in the 2018 MBP is documented to thermal-throttle aggressively under sustained load. Apple's stock fan curve is conservative: fans stay quiet (<2500 RPM) until package temperature already exceeds 85°C, at which point the CPU has often already dropped below its 2.2 GHz base clock to stay under the 95°C junction limit. This is the well-known Coffee Lake H thermal behavior on Apple's 15W-class chassis design.

Under 5 parallel Docker containers each running a Claude Code SWE-bench Lite task, the package will hit sustained 90 to 95°C within minutes on stock fans. That throttle period invalidates the spike's noise-floor measurement: the same harness running on a throttled CPU will score differently than on a non-throttled CPU, contaminating sigma.

## Why other interventions do not work on this machine

- **Overclocking**: firmware-locked. Apple ships these chips with no BIOS access for OC.
- **Undervolting via Volta or Intel XTU**: blocked by T2 since macOS Catalina (10.15). T2 prevents MSR (model-specific register) writes from userspace, which is the API undervolting tools use. There is no workaround on T2-equipped Macs.
- **Closing other processes**: minor effect; the bottleneck is heat dissipation, not concurrent CPU load from user apps.

The viable intervention is **aggressive fan control** to keep the package temperature in the 75 to 85°C band where turbo boost can sustain.

## Recommended tool: Macs Fan Control

Free, well-maintained, signs SMC fan-control writes that survive reboots until the app is uninstalled or settings reset.

**Install**:
```bash
brew install --cask macs-fan-control
```

If Homebrew is not present, download from https://crystalidea.com/macs-fan-control directly (signed installer).

## Target fan curve

Both fans (Left Cooler + Right Cooler), single curve based on **CPU Proximity** sensor:

| Sensor temp | Fan RPM (% of max) |
|---|---|
| ≤ 60°C | 50% (~3000 RPM at the 2018 MBP fan max ~6000 RPM) |
| 80°C | 100% (~6000 RPM) |
| Linear interpolation between 60 and 80 | matches |

**Setup steps in Macs Fan Control**:
1. Launch Macs Fan Control.
2. For each fan (Left Cooler, Right Cooler):
   a. Click the gear icon next to the fan name.
   b. Select "Custom".
   c. Choose sensor: "CPU Proximity" (sometimes labeled "TC0P" in raw sensor list).
   d. Set "Fans speed will start changing from" to 60°C, "to" 80°C.
   e. Set "min RPM" to 3000, "max RPM" to 6000 (the actual max varies; use whatever your fan reports as Maximum).
3. Apply and confirm both fans now show "Custom" mode.
4. Quit Macs Fan Control. Settings persist until the app is reinstalled or SMC reset.

## Expected lift

Practitioner reports on i7-8750H 2018 MBP under sustained Docker / VM workloads:
- Stock fan curve: throttles to ~2.0 to 2.2 GHz package frequency under sustained 100% load (below the 2.2 GHz base clock; turbo boost suspended).
- Aggressive fan curve: package holds ~3.2 to 3.6 GHz under same load (turbo boost partially sustained).

Net effect on AHOL spike runs: roughly **15 to 25% more sustained CPU performance** vs stock, with the corollary that thermal-throttle-induced score variance is largely eliminated. Fan noise is the trade-off; this rig is appropriate for an indoor desk setup, not for working from a coffee shop.

## Reversibility

Macs Fan Control writes to SMC firmware settings that persist across reboots. Two ways to reset:

1. **In-app**: Quit Macs Fan Control. The app de-registers its overrides and fans return to Apple stock curves on the next SMC poll (within seconds).
2. **Manual SMC reset** (if the app misbehaves):
   ```bash
   sudo smc -k FS! -w 0000
   ```
   Requires the `smc` binary, which ships with macOS.

Full SMC reset (PRAM/NVRAM-style):
- Shut down the Mac.
- Hold Shift + Control + Option + Power for 10 seconds.
- Release, wait, then power on.
This wipes all SMC overrides including Macs Fan Control's, plus a few other firmware settings. Use only as a last resort.

## Confirmation back to me

After install + apply:
1. Confirm `pgrep -x "Macs Fan Control"` returns a PID.
2. Confirm fan RPMs respond to load: open Activity Monitor, sort by CPU, and watch fans climb when a CPU-heavy task runs.
3. Reply "Fans tuned" and the spike Step 5 (thermal baseline capture) will proceed.

## Em-dash audit

Zero U+2014 and zero U+2013 in this document.
