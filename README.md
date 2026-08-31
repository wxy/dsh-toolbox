# dsh-toolbox

面向 DeepSeek Harness 的**个人小工具集**（monorepo）。官方不接受外部 PR，所以把这些修修补补做成自己的工具，按用途拆成独立插件包维护，方便自己用、也方便分发给其他 Harness 用户。

---

## 插件总览（先看这张表决定用哪个）

| 插件 | 运行形态 | 用途 |
|---|---|---|
| `session-care` | **纯命令行（离线）** | 会话日志健康检查与修复——界面打不开、日志损坏时用它 |
| `harness-patch` | **命令行应用，效果体现在 Harness 界面/host** | 给已安装的 Harness 打本地补丁：坏日志不拖垮界面、跨工作区拖拽移动会话、未分组锚点等界面能力 |
| `workspace-ops` | **纯命令行** | 会话工作区管理：移入工作区、取消归档、查看归属 |
| `core` | 共享底层库 | 不独立使用（zstd 帧编解码、Harness 探测） |

> 一句话：**界面打不开了用 `session-care` 修日志；想在界面上拖拽整理会话，先 `harness-patch` 打补丁；命令行批量整理工作区用 `workspace-ops`。**

---

## 环境要求与通用安装

- Node.js ≥ 22，**零第三方依赖**（只用 Node 内置模块；运行时从已安装的 Harness 里动态取 `decodeStorageRecord`）。
- `session-care` 与 `harness-patch` 需要能定位到**已安装的 dsh 包**（自动探测 `npm root -g`；或设 `DSH_INSTALL=/path/to/dsh`）。

```sh
git clone https://github.com/wxy/dsh-toolbox.git
cd dsh-toolbox
make install        # 把三个命令软链到 ~/.dsh/tools/bin
export PATH="$HOME/.dsh/tools/bin:$PATH"   # 加入 PATH
# 或者不装，直接 node 跑：
# node packages/session-care/bin/session-care.mjs health
```

---

## 插件 1：`session-care` — 会话日志健康检查与修复（命令行 · 离线）

### 功能 / 用途
Harness 读端对会话日志有两条契约：**物理布局**（第一个 zstd frame 必须恰好是 header 一行）和**内容**（事件 seq 从 0 连续递增）。日志损坏时 Harness 可能直接报 `corrupt session log`，甚至整个界面打不开。本插件：

- **health**：逐会话扫描，精确报告每个日志的健康状态（`ok` / `corrupt` / `unrepairable`）与损坏原因；
- **repair**：修复可恢复的日志，内置三种策略：
  - `repackage-frames` —— 整个日志被压成单个 zstd frame（布局违规）→ 重打包为 `[header帧][事件帧]`；
  - `drop-duplicate-segment` —— 序号回退的重复段（如中断时多写的 `step/end`+`turn/end`）→ 丢弃更早的重复段，保留真实续写；
  - `truncate` —— 前向空洞/不可解析行 → 在首个异常处截断，保留连续前缀。
- **安全保证**：写盘前把原文件备份为 `<path>.corrupt-<时间戳>`；修复产物先过读端自己的校验，不过校验就不落盘；原子发布。

### 用法

```sh
dsh-session-care health                       # 体检全部会话（默认根 ~/.dsh/sessions）
dsh-session-care health --root /path/to/sessions --json
dsh-session-care repair                       # 只看修复计划（dry run，不写盘）
dsh-session-care repair --apply               # 真正修复（原文件保留为 .corrupt-<ts>）
dsh-session-care repair --session <sessionId> --apply   # 只修某一个会话
```

选项：`--root <dir>` 会话根目录；`--session <id>` 只处理指定会话；`--json` 机器可读输出；`--compression <zstd|none>`；`--dsh-install <path>`。

### 适用时机
- Harness 报 `corrupt session log` / `handler failure`、界面（含模型列表）打不开时；
- 升级后想快速确认所有日志健康时。

---

## 插件 2：`harness-patch` — 给已安装的 Harness 打本地补丁（命令行应用 · 效果在界面/host）

### 功能 / 用途
在**已安装的 dsh 包**上打本地补丁（幂等、修改前自动备份、应用后自校验、失败自动回滚；`npm i -g` 升级 Harness 后需重跑）。按能力拆成 9 个可独立应用的补丁：

| 补丁（flag） | 能力 | 生效方式 |
|---|---|---|
| （默认，无 flag） | **韧性补丁**：会话列表对损坏日志宽容——一个坏日志不再拖垮整个界面/模型列表 | host → **重启一次** |
| `--workspace-live` | **实时跨工作区移动**：host 的 `insertSessionBefore` 自动挂账（cwd 匹配时），客户端支持把会话拖到工作区行 | host → 重启；client → 刷新 |
| `--workspace-live-v2` | 拖拽落点高亮 + 移动后自动展开目标工作区并刷新列表 | client → **刷新即生效** |
| `--ungrouped-detach` | 新增 `workspace.detachSession` RPC，**未分组桶常驻显示**，可把工作区会话拖进未分组 | host（RPC）→ 重启；client → 刷新 |
| `--blue-bar` | 跨组拖拽显示**蓝色插入条**（与同组排序一致），落点即精确插入位置（可插到指定会话前/后） | client → 刷新 |
| `--new-session-anchor` | 未分组桶下"＋ 新会话"锚点（点击创建未分组会话，也是拖拽落点） | client → 刷新 |
| `--ungrouped-anchor` | 改为：未分组桶空时**自动常驻一个空会话**（可点开使用，也是拖拽落点） | client → 刷新 |
| `--blank-visible` | 未分组桶**显示空会话**（默认空会话在侧边栏被隐藏——这正是"看不见锚点"的根因） | client → 刷新 |
| `--detach-payload-fix` | 修复 raw RPC 载荷封装 bug（`{args:...}` → 裸载荷），否则 detach/create 校验失败 | client → 刷新 |

**推荐一次性应用全部**（有依赖顺序，脚本会校验前置补丁是否已打）：

```sh
dsh-harness-patch
dsh-harness-patch --workspace-live
dsh-harness-patch --workspace-live-v2
dsh-harness-patch --ungrouped-detach
dsh-harness-patch --blue-bar
dsh-harness-patch --new-session-anchor
dsh-harness-patch --ungrouped-anchor
dsh-harness-patch --blank-visible
dsh-harness-patch --detach-payload-fix
```

应用后：**刷新浏览器**（客户端补丁立即生效）+ **重启一次 Harness**（host 侧补丁：韧性、attach、detach RPC 生效）。

### 界面能力一览（补丁后的效果）
- 侧边栏把"未分组"的会话**拖到工作区**（或反过来拖到未分组）——显示蓝色插入条，松手即插入到精确位置；
- 未分组桶永远有一个**可见的空会话**（可点开直接开始新对话，也是拖拽落点）；
- 一个坏日志不再导致整个界面（含模型列表）打不开。

### 选项
`--dsh-install <path>` 指定已安装 dsh 包根目录（默认自动探测 `npm root -g`）。

---

## 插件 3：`workspace-ops` — 会话工作区管理（命令行）

### 功能 / 用途
直接编辑 `$DSH_HOME/storages/workspace.json`（每次写入前自动备份）完成工作区账目操作：

- **move**：把"未分组"的会话挂到指定工作区（header cwd 需与工作区路径一致）；
- **unarchive**：把会话移出归档列表（Harness 当前**没有**取消归档的入口，这是唯一途径）；
- **list**：查看工作区成员、归档清单、未分组说明。

> ⚠️ 运行中的 Harness 把 workspace.json 读入内存（内存态权威、无热重载），所以本插件的修改**重启 Harness 后生效**；重启前请勿在 GUI 里做归档/移动操作（会被内存状态覆盖）。

### 用法

```sh
dsh-workspace-ops list                                # 查看归属
dsh-workspace-ops list --json
dsh-workspace-ops move <sessionId> --workspace appilot   # 移入工作区（id 或路径）
dsh-workspace-ops unarchive <sessionId>               # 取消归档
```

### 适用时机
- 会话落在"未分组"里想归入工作区（打补丁后其实直接在界面拖就行，本插件适合批量/脚本场景）；
- 归档了一批会话想找回/取消归档。

---

## 常见场景速查

| 场景 | 用什么 |
|---|---|
| 打开会话报 `corrupt session log`，界面打不开 | `dsh-session-care health` → `repair --apply` |
| 想在界面上把会话拖到别的工作区/未分组 | 装 `harness-patch` 全部补丁 → 刷新 + 重启一次 |
| 未分组桶看不到东西 | `--blank-visible`（+ `--ungrouped-anchor`） |
| 归档的会话想取消归档 | `dsh-workspace-ops unarchive <id>` |
| 升级 Harness 后 | 重跑 `dsh-harness-patch` 全部补丁 |

---

## 分发给别人（npm / 仓库）

每个包都是标准 npm 包形状（`package.json` + `bin`），发布后：

```sh
npm i -g @dsh-toolbox/session-care @dsh-toolbox/harness-patch @dsh-toolbox/workspace-ops
```

> 注：发布前需把对 `packages/core` 的相对引用改成对 `@dsh-toolbox/core` 的依赖（core 也要发布）。
> 运行形态说明：`session-care` / `workspace-ops` 定位是**离线/CLI 运维**（日志损坏时 Harness 往往已无法正常加载）；`harness-patch` 是"补丁即插件"机制（Harness 运行时插件 API 不支持新增 RPC/覆盖工作区浏览器，只能改安装包）。如需纯 Cordis 运行时插件或 GUI 斜杠命令入口，可作为后续独立插件包。

仓库已配置 GitHub topics：`ai-agents`、`cordis`、`dsh`、`dsh-plugin`、`deepseek-harness`、`session-management`、`developer-tools`、`cli`、`javascript` 等，可在 GitHub 上按这些标签搜索到。

## 文档

- [事故复盘与修复手册](docs/playbook-session-corruption.md) — 2026-08 会话日志损坏事故的完整复盘：根因、判定方法、三种修复策略、手工速查。

## 许可

MIT
