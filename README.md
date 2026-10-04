# 100Hz 防晕动

用 100 Hz 纯音缓解晕车、晕船、VR/3D 眩晕的 iPhone PWA（可离线、可锁屏后台播放）。

**在线地址：** https://boonewang.github.io/100hz/

## 安装到 iPhone

Safari 打开上面的地址 → 底部「分享」→「添加到主屏幕」。之后从主屏图标打开即全屏运行，用过一次后完全离线可用。

## 功能

- 播放 100 Hz 纯音，默认 40 秒，可切换 20s / 60s / 循环
- 「当前声压级」估算读数 + 建议区间 80~85 dB 进度条
- 锁屏 / 后台继续播放（控制中心可暂停），播放时屏幕保持常亮
- Service Worker 离线缓存、浅色/深色主题、iOS 安全区适配

## 文件

```
index.html            页面结构
styles.css            样式
app.js                逻辑（计时、声压级估算、锁屏控制）
manifest.webmanifest  PWA 清单
sw.js                 Service Worker（离线缓存）
icons/                主屏图标（180/192/512/maskable）
audio/100hz.mp3       100 Hz 纯音，60 秒，44.1 kHz
```

## 本地预览

任意静态服务器均可，例如：

```bash
python3 -m http.server 8080
```

> 注意：Service Worker 需要 HTTPS 或 localhost 才会启用。

## 说明

- iOS 不允许网页调节音量，App 内滑块用于记录音量以估算声压级，实际音量请用侧边音量键。
- 若听不到声音，请检查静音开关。
- 长时间大音量聆听可能损伤听力，如出现耳鸣、头晕加重等不适请立即停止并咨询医生。本应用不能替代医疗建议。
