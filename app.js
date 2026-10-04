/* 100Hz 防晕动 — 应用逻辑
   播放 100 Hz 纯音，帮助缓解晕动症。

   音频走 <audio> 元素（iOS 后台/锁屏可继续播放）。
   音频文件自带 0.45s 淡入 / 0.5s 淡出：iOS 不允许网页设置媒体元素音量，
   硬起播会有一声“嗒”，所以淡入淡出做在音频文件里，而不是用 JS 改音量。
   声压级：优先读系统音量（部分平台会把系统音量映射到媒体元素上），
   读不到时（iOS 通常如此）改为提示用音量键调节，不显示假数字。 */

(function () {
  "use strict";

  var MAX_SPL = 85;          // 以扬声器满音量约 85 dB SPL 为参考
  var MIN_SPL_SCALE = 60;    // 进度条量程
  var MAX_SPL_SCALE = 100;
  var STORE_KEY = "hz100.prefs.v1";

  var $ = function (id) { return document.getElementById(id); };

  var audio = $("tone");
  var volProbe = $("volProbe");
  var playBtn = $("playBtn");
  var playLabel = $("playLabel");
  var timeValue = $("timeValue");
  var timeUnit = $("timeUnit");
  var timeLabel = $("timeLabel");
  var timeBar = $("timeBar");
  var levelValue = $("levelValue");
  var levelTag = $("levelTag");
  var splValue = $("splValue");
  var splUnit = $("splUnit");
  var meterFill = $("meterFill");
  var levelHint = $("levelHint");
  var themeBtn = $("themeBtn");
  var helpBtn = $("helpBtn");
  var sheet = $("sheet");
  var toast = $("toast");
  var a2hs = $("a2hs");
  var a2hsClose = $("a2hsClose");

  var state = {
    preset: 40,        // 秒；0 = 循环
    playing: false,
    paused: false,
    elapsedBase: 0,    // 已累计播放秒数（暂停时结算）
    startedAt: null,   // 本次播放开始的墙上时钟
    wakeLock: null,
    tickerId: null,
    rafId: null,
    booted: false
  };

  // null = 平台不开放系统音量读数
  var systemVolume = null;

  /* ---------------- 偏好存储 ---------------- */

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (typeof p.preset === "number" && [0, 20, 40, 60].indexOf(p.preset) >= 0) state.preset = p.preset;
      if (p.theme) document.documentElement.setAttribute("data-theme", p.theme);
    } catch (e) { /* 忽略 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        preset: state.preset,
        theme: document.documentElement.getAttribute("data-theme") || "auto"
      }));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 系统音量 ---------------- */

  function volumeOf(el) {
    if (!el) return null;
    var v = el.volume;
    return typeof v === "number" && isFinite(v) && v >= 0 && v <= 1 ? v : null;
  }

  // 默认音量就是 1：若读到小于 1，或观察到音量变化，说明平台把系统音量映射到了元素上
  function refreshSystemVolume() {
    if (systemVolume !== null) return true;
    var candidates = [volumeOf(audio), volumeOf(volProbe)];
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i];
      if (v !== null && v < 0.999) { systemVolume = v; return true; }
    }
    return false;
  }

  function volumeToSpl(v) {
    if (v <= 0.001) return 0;
    return MAX_SPL + 20 * Math.log10(v);
  }

  function renderLevel() {
    var readable = refreshSystemVolume();

    if (!readable) {
      levelValue.classList.add("is-guidance");
      splValue.textContent = "请用音量键调节";
      splUnit.textContent = "";
      levelTag.textContent = "系统音量不可读";
      meterFill.style.width = "0%";
      levelHint.textContent = "iOS 不向网页开放系统音量读数：请用侧边音量键调到刚好盖过环境噪音的水平（建议声压级 80~85 dB）。在支持读取系统音量的设备上，这里会随音量键实时变化。";
      return;
    }

    var spl = volumeToSpl(systemVolume);
    levelValue.classList.remove("is-guidance");
    splValue.textContent = systemVolume <= 0.001 ? "--" : String(Math.round(spl));
    splUnit.textContent = systemVolume <= 0.001 ? "" : "dB";
    levelTag.textContent = "跟随系统音量";
    var pct = Math.min(100, Math.max(0, (spl - MIN_SPL_SCALE) / (MAX_SPL_SCALE - MIN_SPL_SCALE) * 100));
    meterFill.style.width = (systemVolume <= 0.001 ? 0 : pct) + "%";
    levelHint.textContent = "实时跟随手机音量键更新（满音量按约 " + MAX_SPL + " dB 估算）。";
  }

  ["volumechange", "volumeChanged"].forEach(function (evt) {
    audio.addEventListener(evt, function () {
      var v = volumeOf(audio);
      if (v !== null) { systemVolume = v; renderLevel(); }
    });
    if (volProbe) {
      volProbe.addEventListener(evt, function () {
        var v = volumeOf(volProbe);
        if (v !== null) { systemVolume = v; renderLevel(); }
      });
    }
  });

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
    timeBar.style.width = Math.min(100, Math.max(0, (1 - left / state.preset) * 100)) + "%";
  }

  /* ---------------- 播放控制 ---------------- */

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
        startTicker();
        renderTimer();
        updateMediaSession();
        requestWakeLock();
        showFirstPlayHint();
      }).catch(function (err) {
        state.playing = false;
        document.body.classList.remove("is-playing");
        showToast("无法播放音频：" + (err && err.message ? err.message : "请检查静音开关"), 4200);
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
    audio.pause();
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
    audio.pause();
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
    audio.pause();
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
    if (document.visibilityState !== "visible") return;
    if (state.playing) { requestWakeLock(); updateTick(); }
    renderLevel();
  });

  /* ---------------- UI 辅助 ---------------- */

  var toastTimer = null;
  function showToast(text, ms) {
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, ms || 2200);
  }

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
      state.paused = false;
      audio.currentTime = 0;   // 回到文件开头（自带淡入），避免中途起播的爆音
      if (!state.playing) play();
    }
    renderTimer();
    savePrefs();
  }

  /* ---------------- 事件绑定 ---------------- */

  playBtn.addEventListener("click", toggle);

  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
    c.addEventListener("click", function () { setPreset(Number(c.dataset.sec)); });
  });

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

  audio.addEventListener("playing", function () { setTimeout(renderLevel, 300); });

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
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
      c.classList.toggle("is-active", Number(c.dataset.sec) === state.preset);
    });
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
