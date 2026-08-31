# dsh-toolbox

面向 DeepSeek Harness 的**个人小工具集**（monorepo）。官方不接受外部 PR，所以把这些修修补补做成自己的工具，按用途拆成独立插件包维护，方便自己用、也方便分发给其他 Harness 用户。

---

## 两个组件（先看这张表决定用哪个）

| 组件 | 形态 | 职责 |
|---|---|---|
| `session-care` | **纯命令行（离线）** | **修复会话文件损坏**——日志损坏可能导致整个 Harness 打不开、无法运行，用它体检并修复 |
| `harness-patch` | **命令行打补丁，能力体现在 Harness 界面** | **会话区管理**：给已安装的 Harness 打补丁，让左侧会话区支持拖拽组织（工作区之间移动、工作区 ↔ 未分组 ↔ 归档全向拖动、归档文件夹、跨目录移动）。**一条命令全打包**；将来给 Harness 增加其他补丁用其他命令行参数 |

> 一句话：**界面打不开 / 日志损坏用 `wxy-session-care` 修；想在界面上拖拽整理会话，用 `wxy-harness-patch` 打一次补丁即可（之后在界面操作，不需要命令行）。**

### 关于命名（官方术语）

- **工作区（workspace）** 是 Harness 的**官方正式名称**：侧边栏区域标题、API（`workspace.*`）、代码都叫它"工作区"——指绑定到某个目录的会话文件夹。
- **未分组（ungrouped）** 和 **归档（archived）** 是官方另外两个会话状态，不属于"工作区"。
- 我们把"把会话在工作区 / 未分组 / 归档之间拖拽组织"的整套能力统称为**会话区管理**（本仓库的非正式统称，方便描述，避免和官方"工作区"概念混淆）。

---

## 环境要求与通用安装

- Node.js ≥ 22，**零第三方依赖**（只用 Node 内置模块；运行时从已安装的 Harness 里动态取 `decodeStorageRecord`）。
- 两个命令都需要能定位到**已安装的 dsh 包**（自动探测 `npm root -g`；或设 `DSH_INSTALL=/path/to/dsh`）。

```sh
git clone https://github.com/wxy/dsh-toolbox.git
cd dsh-toolbox
make install        # 把两个命令软链到 ~/.dsh/tools/bin
export PATH="$HOME/.dsh/tools/bin:$PATH"
# 或者不装，直接 node 跑：
# node packages/session-care/bin/wxy-session-care.mjs health
```

---

## 组件 1：`session-care` — 会话日志修复（命令行 · 离线）

### 功能 / 用途
Harness 读端对会话日志有两条契约：**物理布局**（第一个 zstd frame 必须恰好是 header 一行）和**内容**（事件 seq 从 0 连续递增）。日志损坏时 Harness 可能报 `corrupt session log`，甚至整个界面打不开。本组件：

- **health**：逐会话扫描，报告每个日志的健康状态（`ok` / `corrupt` / `unrepairable`）与损坏原因；
- **repair**：修复可恢复的日志，三种策略：
  - `repackage-frames` —— 整个日志被压成单个 zstd frame（布局违规）→ 重打包为 `[header帧][事件帧]`；
  - `drop-duplicate-segment` —— 序号回退的重复段（如中断时多写的 `step/end`+`turn/end`）→ 丢弃更早的重复段，保留真实续写；
  - `truncate` —— 前向空洞/不可解析行 → 在首个异常处截断，保留连续前缀。
- **安全保证**：写盘前把原文件备份为 `<path>.corrupt-<时间戳>`；修复产物先过读端自己的校验，不过校验就不落盘；原子发布。

### 用法

```sh
wxy-session-care health                       # 体检全部会话（默认根 ~/.dsh/sessions）
wxy-session-care health --root /path/to/sessions --json
wxy-session-care repair                       # 只看修复计划（dry run，不写盘）
wxy-session-care repair --apply               # 真正修复（原文件保留为 .corrupt-<ts>）
wxy-session-care repair --session <sessionId> --apply
```

选项：`--root <dir>` 会话根目录；`--session <id>` 只处理指定会话；`--json`；`--compression <zstd|none>`；`--dsh-install <path>`。

### 已知错误消息速查（搜索你的报错，判断是否一致）

| 你看到的错误 | 含义 | 处理 |
|---|---|---|
| `corrupt session log: seq gap in committed region at line N (expected X, got Y)` | 事件序号重复/回退——通常是中断时多写了一对 `step/end`+`turn/end`，随后真实续写又从旧序号开始 | `repair --apply`（`drop-duplicate-segment`，保留真实续写） |
| `corrupt Zstandard session log: first frame is not exactly one header line` | 日志的 zstd 帧布局违规（例如整个日志被重压成单个 frame；读端要求第一个 frame 恰好是 header 一行） | `repair --apply`（`repackage-frames`） |
| `handler failure: corrupt Zstandard session log: ...`（整个会话列表/界面打不开，含模型列表） | 会话根目录里存在坏日志，列表扫描整体抛错 | 先 `health` 定位，再 `repair --apply` |
| `corrupt session log: invalid header line in ...` / `header id ... does not match ...` | header 损坏，或日志放错了位置 | `unrepairable` 或手动改名/从备份恢复 |

### 适用时机
- Harness 报 `corrupt session log` / `handler failure`、界面（含模型列表）打不开时；
- 升级后想快速确认所有日志健康时。

---

## 组件 2：`harness-patch` — 会话区管理补丁（命令行打一次，能力在界面）

### 功能 / 用途
在**已安装的 dsh 包**上打补丁（幂等、修改前自动备份、应用后自校验、失败自动回滚；`npm i -g` 升级 Harness 后需重跑）。**一条命令应用全部会话区补丁**：

```sh
wxy-harness-patch        # 应用全部补丁（幂等；升级 Harness 后重跑）
```

> 高级：将来给 Harness 增加其他补丁，用其他命令行参数单独应用；现有单个补丁也可单独重打（`--workspace-live` / `--blue-bar` / `--workspace-bundle` 等，见命令帮助）。

### 打补丁后，界面（左侧会话区）获得的能力

- **拖拽组织会话**，显示蓝色插入条，松手即插入到精确位置：
  - 工作区之间移动会话（跨目录移动会弹窗确认，把会话的工作目录改为目标工作区；仅支持未运行的会话）；
  - 工作区 ↔ 未分组（拖到未分组 = 移出工作区）；
  - 工作区 ↔ **归档文件夹**（拖进归档 = 归档；从归档拖到工作区/未分组 = **解除归档**并移入）；
  - 未分组 ↔ 工作区 / 归档（全向拖动）。
- **归档文件夹**常驻侧边栏，列出所有归档会话，方便找回；
- **未分组桶**始终有一个可见的空会话（可点开直接开始新对话，也是拖拽落点）；
- **韧性**：一个坏日志不再导致整个界面（含模型列表）打不开。

### 生效方式

- **刷新浏览器**：客户端能力立即生效（拖拽、归档文件夹、未分组锚点等）；
- **重启一次 Harness**：host 侧 RPC 生效（attach/detach、unarchive、跨目录移动、韧性）。

### 选项

`--dsh-install <path>` 指定已安装 dsh 包根目录（默认自动探测 `npm root -g`）。

---

## 可选脚本工具（已并入补丁，非独立组件）

`packages/workspace-ops` 的脚本能力（`list` / `move` / `unarchive`）**已并入 `harness-patch` 的界面功能**，不再作为独立命令安装。源码保留在仓库中，如需批量/脚本场景可手动运行：

```sh
node packages/workspace-ops/bin/wxy-workspace-ops.mjs list
```

---

## 常见场景速查

| 场景 | 用什么 |
|---|---|
| 打开会话报 `corrupt session log`，界面打不开 | `wxy-session-care health` → `repair --apply` |
| 想在界面上拖拽整理会话（工作区/未分组/归档） | `wxy-harness-patch` 一次 → 刷新 + 重启一次 |
| 侧边栏出现两个"未分组" | 那是补丁前的旧 bundle；重新应用补丁后归档文件夹显示为"归档" |
| 归档的会话想找回/解除归档 | 界面：从归档文件夹拖到工作区/未分组；脚本：`workspace-ops`（可选） |
| 升级 Harness 后 | 重跑 `wxy-harness-patch` |

---

## 分发给别人（npm / 仓库）

每个包都是标准 npm 包形状（`package.json` + `bin`），发布后：

```sh
npm i -g @dsh-toolbox/session-care @dsh-toolbox/harness-patch
# 安装后命令为 wxy-session-care / wxy-harness-patch
```

> 注：发布前需把对 `packages/core` 的相对引用改成对 `@dsh-toolbox/core` 的依赖（core 也要发布）。
> 形态说明：`session-care` 是**离线 CLI 修复**（日志损坏时 Harness 往往已无法加载）；`harness-patch` 是"补丁即插件"（Harness 运行时插件 API 不支持新增 RPC/覆盖工作区浏览器，只能改安装包）。如需纯 Cordis 运行时插件或 GUI 斜杠命令入口，可作为后续独立插件包。

仓库已配置 GitHub topics：`ai-agents`、`cordis`、`dsh`、`dsh-plugin`、`deepseek-harness`、`session-management`、`developer-tools`、`cli`、`javascript` 等。

## 文档

- [事故复盘与修复手册](docs/playbook-session-corruption.md) — 2026-08 会话日志损坏事故的完整复盘：根因、判定方法、三种修复策略、手工速查。

## 许可

MIT
