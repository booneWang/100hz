# 100Hz Motion Relief

A 100 Hz pure tone that eases motion sickness (car, boat, VR/3D). Installable as an iPhone web app:
works offline, keeps playing on the lock screen, and has no in-app volume (use the hardware buttons).

**Live:** https://boonewang.github.io/100hz/

## Basis

Gu Y, Ohgami N, He T, Kagawa T, Kurniasari F, Tong K, Li X, Tazaki A, Takeda K, Mouri M, Kato M.
*Just 1-min exposure to a pure tone at 100 Hz with daily exposable sound pressure levels may improve motion sickness.*
Environ Health Prev Med. 2025;30. doi:[10.1265/ehpm.24-00247](https://doi.org/10.1265/ehpm.24-00247) (Nagoya University)

The tone is transduced by the **otoconia** of the utricle and saccule, so it activates the otolith organs rather than
hearing alone. In the study, a single **1-minute, bilateral exposure at 80–85 dB(Z) = 60.9–65.9 dB(A) before motion**
reduced postural imbalance, autonomic dysregulation and subjective symptoms — in mice the effect lasted ≥ 120 min.

## Install on iPhone

Open the live URL in Safari → **Share** → **Add to Home Screen**. After one play it is fully offline.

## Features

- 100 Hz pure tone; default session 60 s (the study protocol), plus 20 s / 40 s / loop
- Session timer, progress bar, screen stays awake while playing
- Lock-screen / background playback (Media Session controls)
- "WHY 100 Hz" card: English summary, formulas (`s(t)`, `L_Z`, A-weighting) and two SVG figures
- Service worker offline cache, light/dark theme, iOS safe-area layout
- No in-app volume; guidance for setting the hardware volume instead

## Files

```
index.html            page
styles.css            styles
app.js                logic (timer, playback, wake lock, media session)
manifest.webmanifest  PWA manifest
sw.js                 service worker (offline cache)
icons/                home-screen icons (180/192/512/maskable)
audio/100hz.mp3       100 Hz pure tone, 60 s, 44.1 kHz
diag.html             volume-readability check (utility page, not linked)
```

## Audio

- Source `1Hhz.mp3` (320 kbps / 44.1 kHz / 60 s) was re-encoded to `audio/100hz.mp3`.
- Shape: **0–0.3 s digital silence → 0.3–1.0 s fade-in → tone → 59.4–60 s fade-out.**
  The silent lead-in and the playback-to-zero rule in `app.js` are what keep iOS from producing a
  loud click at the start (iOS does not allow JS to set media volume or fade).
- Verified: stable 100.0 Hz sine, peak −3 dBFS, RMS −6 dBFS, first samples exactly zero.

## Local preview

```bash
python3 -m http.server 8080
```

Service workers need HTTPS or localhost.

## Notes

- iOS never exposes the system volume to web pages, so the app deliberately shows no dB figure.
- No sound? Check the ring/silent switch, then raise the volume with the side buttons.
- Long exposure at high volume can damage hearing; this app is not medical advice.
