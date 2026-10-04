# 100Hz 防晕动

用 100 Hz 纯音缓解晕车、晕船、VR/3D 眩晕的 iPhone PWA（可离线、可锁屏后台播放）。

依据：Gu Y, Ohgami N, He T, et al. *Just 1-min exposure to a pure tone at 100 Hz with daily exposable
sound pressure levels may improve motion sickness.* Environ Health Prev Med. 2025;30. doi:10.1265/ehpm.24-00247

**在线地址：** https://boonewang.github.io/100hz/

## 安装到 iPhone

Safari 打开上面的地址 → 底部「分享」→「添加到主屏幕」。之后从主屏图标打开即全屏运行，用过一次后完全离线可用。

## 功能

- 播放 100 Hz 纯音，默认 40 秒，可切换 20s / 60s / 循环
- 「WHY 100 Hz」原理卡片：英文说明 + 公式（s(t)、L_Z、A 计权换算）+ 两张示意图
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
audio/100hz.mp3       100 Hz 纯音，60 秒，44.1 kHz（0.3s 静音 + 0.7s 淡入 + 0.6s 淡出）
diag.html             音量检测页（排查设备是否允许网页读取系统音量）
```

## 本地预览

任意静态服务器均可，例如：

```bash
python3 -m http.server 8080
```

> 注意：Service Worker 需要 HTTPS 或 localhost 才会启用。

## 说明

- App 内不设音量条：iOS 不允许网页设置媒体音量，音量请用侧边音量键调节（论文参考值 80~85 dB(Z) = 60.9~65.9 dB(A)）。
- 音频文件开头有 0.3 秒真静音、0.7 秒淡入，结尾 0.6 秒淡出；暂停/结束时播放位置归零，因此每次起播都落在静音区，避免 iPhone 上“嗒”的一声，循环接缝也无声。
- 界面不显示声压级数值：iOS 不向网页开放系统音量读数，显示的数字没有意义；改为论文原理说明。
- 若听不到声音，请检查静音开关。
- 长时间大音量聆听可能损伤听力，如出现耳鸣、头晕加重等不适请立即停止并咨询医生。本应用不能替代医疗建议。
