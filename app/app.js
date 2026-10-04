/* 100Hz 防晕动 — 应用逻辑
   播放 100 Hz 纯音，帮助缓解晕动症。
   音频走 <audio> 元素（iOS 后台/锁屏可继续播放），声压级为音量估算值。 */

(function () {
  "use strict";

  var MAX_SPL = 85;      // 以扬声器满音量约 85 dB SPL 为参考
  var MIN_SPL_SCALE = 60;   // 进度条量程
  var MAX_SPL_SCALE = 100;
  var FADE_IN = 600;
  var FADE_OUT = 900;
  var STORE_KEY = "hz100.prefs.v1";

  var $ = function (id) { return document.getElementById(id); };

  var audio = $("tone");
  var playBtn = $("playBtn");
  var playLabel = $("playLabel");
  var timeValue = $("timeValue");
  var timeUnit = $("timeUnit");
  var timeLabel = $("timeLabel");
  var timeBar = $("timeBar");
  var splValue = $("splValue");
  var meterFill = $("meterFill");
  var levelHint = $("levelHint");
  var volSlider = $("volSlider");
  var volHint = $("volHint");
  var volTag = $("volTag");
  var themeBtn = $("themeBtn");
  var helpBtn = $("helpBtn");
  var sheet = $("sheet");
  var toast = $("toast");
  var a2hs = $("a2hs");
  var a2hsClose = $("a2hsClose");

  var state = {
    preset: 40,        // 秒；0 = 循环
    playing: false,    // 音频正在播放
    paused: false,     // 从播放中暂停
    elapsedBase: 0,    // 已累计的播放秒数（暂停时结算）
    startedAt: null,   // 本次播放开始的墙上时钟
    targetVol: 0.8,
    recenters: null,
    wakeLock: null,
    tickerId: null,
    rafId: null,
    fadeTimer: null,
    booted: false
  };

  /* iOS(Safari) 不允许网页设置 media 元素音量：
     探测后降级为「参考音量」，只用于声压级估算，实际音量由侧边音量键控制。 */
  var canControlVolume = (function () {
    try {
      var probe = document.createElement("audio");
      probe.volume = 0.37;
      return Math.abs(probe.volume - 0.37) < 0.02;
    } catch (e) { return false; }
  })();

  /* ---------------- 偏好存储 ---------------- */

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (typeof p.volume === "number") state.targetVol = Math.min(1, Math.max(0, p.volume));
      if (typeof p.preset === "number" && [0, 20, 40, 60].indexOf(p.preset) >= 0) state.preset = p.preset;
      if (p.theme) document.documentElement.setAttribute("data-theme", p.theme);
    } catch (e) { /* 忽略 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        volume: state.targetVol,
        preset: state.preset,
        theme: document.documentElement.getAttribute("data-theme") || "auto"
      }));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 声压级估算 ---------------- */

  function volumeToSpl(v) {
    if (v <= 0.001) return 0;
    return MAX_SPL + 20 * Math.log10(v);
  }

  function renderLevel() {
    var v = state.targetVol;
    var spl = volumeToSpl(v);
    var shown = v <= 0.01 ? 0 : Math.round(spl);
    splValue.textContent = v <= 0.01 ? "--" : String(shown);
    var pct = Math.min(100, Math.max(0, (spl - MIN_SPL_SCALE) / (MAX_SPL_SCALE - MIN_SPL_SCALE) * 100));
    meterFill.style.width = (v <= 0.01 ? 0 : pct) + "%";
    volTag.textContent = Math.round(v * 100) + "%";
    levelHint.textContent = "音量 " + Math.round(v * 100) + "% · 以扬声器满音量约 " +
      MAX_SPL + " dB 估算" + (canControlVolume ? "" : "（iOS 请用侧边音量键）");
    if (volHint) {
      volHint.textContent = canControlVolume
        ? "建议由小到大逐步调整，找到刚好能遮盖不适感的音量。"
        : "iPhone 上请用侧边音量键调整实际音量；此滑块用于记录当前音量，以便估算声压级。";
    }
  }

  /* ---------------- 计时显示 ---------------- */

  // 已播放秒数：以墙上时钟计算，后台/锁屏时依然准确
  function elapsedSeconds() {
    var e = state.elapsedBase;
    if (state.playing && state.startedAt) e += (Date.now() - state.startedAt) / 1000;
    return e;
  }

  function remainingSeconds() {
    return state.preset > 0 ? Math.max(0, state.preset - elapsedSeconds()) : 0;
  }

  function fmt(seconds) {
    seconds = Math.max(0, Math.ceil(seconds));
    if (state.preset >= 60 || seconds >= 60) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return m + ":" + (s < 10 ? "0" : "") + s;
    }
    return String(seconds);
  }

  function renderTimer() {
    if (state.preset === 0) {
      timeValue.textContent = fmt(elapsedSeconds());
      timeUnit.textContent = "";
      timeLabel.textContent = state.playing ? "已播放 · 循环中" : "循环播放";
      var dur = audio.duration && isFinite(audio.duration) ? audio.duration : 60;
      timeBar.style.width = Math.min(100, (audio.currentTime || 0) / dur * 100) + "%";
      return;
    }
    var left = state.playing || state.paused ? remainingSeconds() : state.preset;
    timeValue.textContent = fmt(left);
    timeUnit.textContent = state.preset >= 60 ? "" : "s";
    timeLabel.textContent = state.playing ? "剩余时间" : (state.paused ? "已暂停" : "本次时长");
    var total = state.preset;
    timeBar.style.width = Math.min(100, Math.max(0, (1 - left / total) * 100)) + "%";
  }

  /* ---------------- 播放控制 ---------------- */

  function setFade(from, to, ms, done) {
    if (!canControlVolume) {           // iOS 无法调节元素音量，直接切换
      if (done) done();
      return;
    }
    if (state.fadeTimer) { clearInterval(state.fadeTimer); state.fadeTimer = null; }
    var start = performance.now();
    audio.volume = from;
    if (ms <= 0) {
      audio.volume = to;
      if (done) done();
      return;
    }
    state.fadeTimer = setInterval(function () {
      var t = (performance.now() - start) / ms;
      if (t >= 1) {
        audio.volume = to;
        clearInterval(state.fadeTimer);
        state.fadeTimer = null;
        if (done) done();
      } else {
        audio.volume = from + (to - from) * t;
      }
    }, 40);
  }

  function updateTick() {
    if (!state.playing) return;
    if (state.preset > 0 && remainingSeconds() <= 0) { finishSession(); return; }
    renderTimer();
  }

  function startTicker() {
    stopTicker();
    // 双保险：动画帧负责前台流畅，定时器负责后台（含锁屏）继续计时
    state.tickerId = setInterval(updateTick, 200);
    var loop = function () {
      if (!state.playing) return;
      updateTick();
      state.rafId = requestAnimationFrame(loop);
    };
    state.rafId = requestAnimationFrame(loop);
  }

  function stopTicker() {
    if (state.tickerId) { clearInterval(state.tickerId); state.tickerId = null; }
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
  }

  function play() {
    var p = audio.play();
    if (p && typeof p.then === "function") {
      p.then(function () {
        state.playing = true;
        state.paused = false;
        state.startedAt = Date.now();
        document.body.classList.add("is-playing");
        playLabel.textContent = "暂停";
        if (state.fadeTimer) { clearInterval(state.fadeTimer); state.fadeTimer = null; }
        setFade(canControlVolume ? 0 : 1, state.targetVol, FADE_IN);
        startTicker();
        renderTimer();
        updateMediaSession();
        requestWakeLock();
        showFirstPlayHint();
      }).catch(function (err) {
        state.playing = false;
        document.body.classList.remove("is-playing");
        showToast("无法播放音频：" + (err && err.message ? err.message : "请检查静音开关") , 4200);
        renderTimer();
      });
    }
  }

  function pause() {
    if (state.playing) {
      state.elapsedBase += (Date.now() - (state.startedAt || Date.now())) / 1000;
      state.startedAt = null;
    }
    state.playing = false;
    state.paused = true;
    stopTicker();
    setFade(audio.volume, 0, 220, function () {
      audio.pause();
    });
    document.body.classList.remove("is-playing");
    playLabel.textContent = "继续播放";
    renderTimer();
    updateMediaSession();
    releaseWakeLock();
  }

  function finishSession() {
    state.playing = false;
    state.paused = false;
    state.elapsedBase = 0;
    state.startedAt = null;
    stopTicker();
    setFade(audio.volume, 0, FADE_OUT, function () { audio.pause(); });
    document.body.classList.remove("is-playing");
    playLabel.textContent = "开始播放";
    renderTimer();
    updateMediaSession();
    releaseWakeLock();
    if (navigator.vibrate) navigator.vibrate([18, 90, 18]);
    showToast("本次 " + state.preset + " 秒播放完成", 2400);
  }

  function resetToIdle() {
    state.playing = false;
    state.paused = false;
    state.elapsedBase = 0;
    state.startedAt = null;
    stopTicker();
    if (state.fadeTimer) { clearInterval(state.fadeTimer); state.fadeTimer = null; }
    audio.pause();
    if (canControlVolume) audio.volume = 0;
    audio.currentTime = 0;
    document.body.classList.remove("is-playing");
    playLabel.textContent = "开始播放";
    renderTimer();
    updateMediaSession();
    releaseWakeLock();
  }

  function toggle() {
    if (state.playing) pause();
    else play();
  }

  /* ---------------- 锁屏 / 后台 ---------------- */

  function updateMediaSession() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "100 Hz 防晕动",
        artist: "100 Hz 纯音",
        album: "缓解晕动症"
      });
      navigator.mediaSession.playbackState = state.playing ? "playing" : (state.paused ? "paused" : "none");
      navigator.mediaSession.setActionHandler("play", function () { if (!state.playing) play(); });
      navigator.mediaSession.setActionHandler("pause", function () { if (state.playing) pause(); });
      navigator.mediaSession.setActionHandler("stop", function () { resetToIdle(); });
    } catch (e) { /* 忽略 */ }
  }

  function requestWakeLock() {
    if (!("wakeLock" in navigator) || state.wakeLock) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      state.wakeLock = lock;
      lock.addEventListener("release", function () { state.wakeLock = null; });
    }).catch(function () { /* 忽略 */ });
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      try { state.wakeLock.release(); } catch (e) { /* 忽略 */ }
      state.wakeLock = null;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.playing) requestWakeLock();
    if (document.visibilityState === "visible" && state.playing) updateTick();
  });

  /* ---------------- UI 辅助 ---------------- */

  var toastTimer = null;
  function showToast(text, ms) {
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, ms || 2200);
  }

  // 首次播放提示（iOS 静音开关最容易踩坑）
  function showFirstPlayHint() {
    try {
      if (localStorage.getItem("hz100.played.once") === "1") return;
      localStorage.setItem("hz100.played.once", "1");
    } catch (e) { /* 忽略 */ }
    setTimeout(function () {
      showToast("听不到声音？请检查静音开关，并用侧边音量键调大音量", 4200);
    }, 900);
  }

  function openSheet() { sheet.hidden = false; }
  function closeSheet() { sheet.hidden = true; }

  function setPreset(sec) {
    state.preset = sec;
    state.elapsedBase = 0;
    state.startedAt = state.playing ? Date.now() : null;
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
      c.classList.toggle("is-active", Number(c.dataset.sec) === sec);
    });
    if (state.playing || state.paused) {
      // 播放中切换时长：重置倒计时并继续播放
      state.paused = false;
      audio.currentTime = 0;
      if (!state.playing) play();
    }
    renderTimer();
    savePrefs();
  }

  function setVolume(v, announce) {
    state.targetVol = Math.min(1, Math.max(0, v));
    volSlider.value = String(Math.round(state.targetVol * 100));
    renderLevel();
    if (state.playing) {
      if (state.fadeTimer) { clearInterval(state.fadeTimer); state.fadeTimer = null; }
      if (canControlVolume) audio.volume = state.targetVol;
    }
    if (announce) savePrefs();
  }

  /* ---------------- 事件绑定 ---------------- */

  playBtn.addEventListener("click", function () {
    toggle();
  });

  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
    c.addEventListener("click", function () { setPreset(Number(c.dataset.sec)); });
  });

  volSlider.addEventListener("input", function () { setVolume(Number(volSlider.value) / 100, false); });
  volSlider.addEventListener("change", function () { setVolume(Number(volSlider.value) / 100, true); });

  themeBtn.addEventListener("click", function () {
    var isDark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (document.documentElement.getAttribute("data-theme") === "auto" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
    savePrefs();
  });

  helpBtn.addEventListener("click", openSheet);
  sheet.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-close")) closeSheet();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSheet();
  });

  a2hsClose.addEventListener("click", function () {
    a2hs.hidden = true;
    try { localStorage.setItem("hz100.a2hs.dismissed", "1"); } catch (e) { /* 忽略 */ }
  });

  audio.addEventListener("error", function () {
    showToast("音频加载失败，请确认 audio/100hz.mp3 存在", 4000);
    playLabel.classList.add("no-audio");
  });

  audio.addEventListener("ended", function () {
    if (state.preset > 0 && state.playing) finishSession();
  });

  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });

  /* ---------------- 启动 ---------------- */

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function maybeShowA2HS() {
    var ua = navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var dismissed = false;
    try { dismissed = localStorage.getItem("hz100.a2hs.dismissed") === "1"; } catch (e) { /* 忽略 */ }
    if (isIOS && !isStandalone() && !dismissed) {
      setTimeout(function () { a2hs.hidden = false; }, 1800);
    }
  }

  function boot() {
    loadPrefs();
    if (!document.documentElement.getAttribute("data-theme")) {
      document.documentElement.setAttribute("data-theme", "auto");
    }
    volSlider.value = String(Math.round(state.targetVol * 100));
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
      c.classList.toggle("is-active", Number(c.dataset.sec) === state.preset);
    });
    if (canControlVolume) audio.volume = 0;
    renderLevel();
    renderTimer();
    updateMediaSession();
    maybeShowA2HS();
    state.booted = true;
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* 忽略 */ });
    });
  }

  boot();
})();
