# @dsh-toolbox/session-care

DeepSeek Harness 会话日志**健康检查与修复**工具（离线命令行）。日志损坏可能导致整个 Harness
打不开、无法运行——用它体检并修复。

```sh
npm i -g @dsh-toolbox/session-care
dtb-session-care health     # 体检全部会话日志（默认根 ~/.dsh/sessions）
dtb-session-care repair     # 看修复计划（dry run，不写盘）
dtb-session-care repair --apply   # 真正修复（原文件保留为 .corrupt-<时间戳>）
```

## 修复策略

- **repackage-frames**：整个日志被压成单个 zstd frame（读端要求第一个 frame 恰好是 header 一行）→ 重打包为 `[header帧][事件帧]`；
- **drop-duplicate-segment**：事件序号回退的重复段（如中断时多写的 `step/end`+`turn/end`）→ 丢弃更早的重复段，保留真实续写；
- **truncate**：前向空洞/不可解析行 → 在首个异常处截断，保留连续前缀。

安全保证：写盘前备份原文件；修复产物先过读端自己的校验，不过校验就不落盘；原子发布。

## 已知错误消息速查

| 你看到的错误 | 含义 | 处理 |
|---|---|---|
| `corrupt session log: seq gap in committed region at line N (expected X, got Y)` | 事件序号重复/回退 | `repair --apply` |
| `corrupt Zstandard session log: first frame is not exactly one header line` | 日志被压成单帧/布局违规 | `repair --apply` |
| `handler failure: corrupt Zstandard session log: ...`（界面打不开） | 会话根目录有坏日志 | 先 `health` 定位再 `repair --apply` |
| `corrupt session log: invalid header line ...` / `header id ... does not match ...` | header 损坏或放错位置 | `unrepairable` 或改名/恢复备份 |

---

## English

Offline CLI to **health-check and repair DeepSeek Harness session logs**. A corrupt log can keep
the whole Harness from starting — use this to diagnose and fix.

```sh
npm i -g @dsh-toolbox/session-care
dtb-session-care health     # scan every session log (default root ~/.dsh/sessions)
dtb-session-care repair     # plan repairs only (dry run)
dtb-session-care repair --apply   # write repairs (originals kept as .corrupt-<ts>)
```

Repair strategies:

- **repackage-frames** — the whole log was compressed into one zstd frame (the reader requires
  the first frame to be exactly the header line) → repackage as `[header frame][event frame]`;
- **drop-duplicate-segment** — a duplicated segment with rewinded sequence numbers (e.g. a
  premature `step/end` + `turn/end` written on interruption, followed by the real continuation)
  → drop the earlier duplicate run, keep the real continuation;
- **truncate** — forward gaps / unparsable rows → truncate at the first anomaly, keeping the
  contiguous prefix.

Safety: the original is backed up before writing; every repair is re-verified with the reader's
own checks before publishing; publishes are atomic.

## License

MIT
