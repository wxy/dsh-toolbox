# 事故复盘与修复手册：会话日志损坏（2026-08）

> 本手册来自一次真实事故的完整复盘。它既是排障指南，也是 `dsh-toolbox` 各插件的设计依据。

## 事故经过（摘要）

1. 某个会话的日志出现**重复段**：turn 21 被中断时多写了一对 `step/end` + `turn/end`（seq 308007/308008），随后真正的续写内容又以 seq 308007 重新开始，造成 committed region 序号出现回退。
2. Harness 加载该会话时抛错：`corrupt session log: seq gap in committed region at line 19827 (expected 308009, got 308007)`。
3. **最糟糕的连锁反应**：只要会话根目录里存在一个"头部帧格式错误"的日志（例如整个日志被重压成单个 zstd frame），`session.list` 这个 API 会整体抛 `handler failure` —— 侧边栏、会话引导、对话框和设置里的模型列表全部打不开。一个坏日志拖垮了整个应用。
4. 后续"修复"又踩了第二个坑：把修复后的内容重压成**单个 zstd frame**（内容对、帧结构错），Harness 读端要求**第一个 frame 必须恰好只含 header 一行**，于是加载依旧失败，且 `session.list` 再次整体崩溃。

## 两个根因

### 根因 1：坏日志是全局单点故障

Harness 的会话列表 `listArtifacts()` 会遍历所有会话目录，逐个读头部帧；任何一个文件在以下任一检查失败都会**直接抛错终止整个列表**：

- zstd 帧魔数/帧头非法；
- 第一个 frame 不是恰好一行 header（`assertZstdHeaderFrame`）；
- header 无法解析 / 不是 session header；
- header 的 id/cwd 与物理路径不一致（`assertStoredIdentity`）。

而 `session.list`、侧边栏、projection、以及依赖同一数据流的模型列表都经过这条路。**对策见 `harness-patch` 插件**：列表对单个坏文件宽容（记录并跳过），`listWithCorruption()/listCorrupt()` 单独上报；重复 id 这类存储级不变量仍保持硬抛。

### 根因 2：修复必须同时满足"内容契约"和"物理布局契约"

Harness 读端对会话日志有两条独立契约：

1. **物理布局**：第一个 zstd frame 解压后必须恰好是 header 行 + `\n`（`assertZstdHeaderFrame`）。正常写入格式是 `[header帧][事件批次帧…]`，每个 frame 独立可解、带校验和。
2. **内容**：事件行的 seq 必须从 0 连续递增，无空洞、无重复（`SessionLogScanner` 的 committed-region 检查）。

修复时必须两条都满足，缺一不可。**对策见 `session-care` 插件**：先扫描定位，再按策略修复，且修复产物先过读端自己的校验才落盘。

## 判定方法（怎么确认日志坏了）

1. 症状：打开某会话报 `corrupt session log: ...`，或整个界面（含模型列表）报 `handler failure`。
2. 定位：`dtb-session-care health` 逐会话扫描，输出状态与原因：
   - `corrupt`：可修复（帧布局错 / 重复段 / 前向空洞 / 不可解析行）。
   - `unrepairable`：header 本身损坏，无恢复前缀。
   - header id 与目录名不符：属于放错位置，手动改名或从备份恢复。
3. 手工确认（不依赖工具时）：
   - 帧数：`zstd -lv <file>` 或解压第一个 frame 看是否只有 header 行。
   - 序号：解压全文后逐行检查 `seq` 是否连续（注意 `reasoning-chunks` 等打包行用 `seq0`，需 `decodeStorageRecord` 展开）。

## 修复策略（session-care 内置，对应真实案例）

| 损坏类型 | 策略 | 说明 |
|---|---|---|
| 整个日志压缩在单个 frame（首帧不是恰好 header 行） | `repackage-frames` | 解出全文 → 拆出 header 行 → 按 `[header帧][事件帧]` 用带校验和参数重压 |
| 重复段（seq 回退，如中断时多写的 step/end+turn/end 之后真实内容又从旧 seq 开始） | `drop-duplicate-segment` | 在首个异常行，丢弃"更早出现的那段重复 seq"的行区间，保留后续连续区段；先验证保留区段连续，否则退化为截断 |
| 前向空洞（seq 跳号，数据丢失） | `truncate` | 在首个异常行截断，保留连续前缀 |
| 不可解析行 | `truncate` | 同上 |

**安全性**：每次写盘前把原文件复制为 `<path>.corrupt-<时间戳>`；修复产物先过读端校验（帧布局 + 序号连续），不过校验就不落盘；落盘用临时文件 + rename 原子发布。

## 手工修复速查（不依赖工具）

```sh
# 1) 解压损坏日志
zstd -d -o /tmp/log.jsonl <损坏文件>

# 2) 看异常行上下文（示例：19826/19827 是中断时多写的）
sed -n '19824,19830p' /tmp/log.jsonl | cut -c1-120

# 3) 去掉重复段（保留真实续写）：删掉 19826、19827 两行
sed '19826,19827d' /tmp/log.jsonl > /tmp/fixed.jsonl

# 4) 校验序号连续（0..N-1，逐事件）
node -e '... 用 decodeStorageRecord 展开后检查 seq ...'

# 5) 按规范帧结构重打包（首帧=header 行，后续帧=事件）
#    使用 node:zlib zstdCompress，参数 ZSTD_c_checksumFlag=1
#    [headerFrame][eventsFrame] 拼接

# 6) 先备份原文件，再原子替换；重启 Harness 前建议再用 dtb-session-care health 复检
```

## 给 Harness 使用者的三条建议

1. **升级后重跑 `dtb-harness-patch`**（npm 全局包升级会覆盖已打补丁的文件）。
2. **不要用第三方工具把会话 JSONL 重压成单帧**；要改内容就用 `dtb-session-care repair`，它会保证帧布局。
3. **归档 ≠ 删除**：归档的会话日志仍在 `~/.dsh/sessions/...` 下，只是 UI 不再显示；当前版本没有"取消归档"的入口，用 `dtb-workspace-ops unarchive`。
