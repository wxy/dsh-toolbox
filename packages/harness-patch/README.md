# @dsh-toolbox/harness-patch

给已安装的 DeepSeek Harness 打**会话区管理补丁**——一条命令全打包，之后在左侧会话区里拖拽整理会话
（工作区 / 未分组 / 归档 之间全向移动、归档文件夹、跨目录移动、未分组锚点、坏日志韧性）。

```sh
npm i -g @dsh-toolbox/harness-patch
dtb-harness-patch        # 交互式：状态一览 → 确认 → 逐补丁应用（幂等；升级 Harness 后重跑）
```

默认运行进入**交互式界面**（全屏 TUI）：先显示各组状态一览（每个文件一行，带进度条与
待应用 / 已具备 / 无法匹配 计数），确认后逐补丁应用并实时刷新进度；应用失败时提供
"撤销 / 升级 Harness / 升级补丁模块"的选择。按 `H` 随时查看帮助。非 TTY（管道 / CI）
自动降级为文本流程；`DSH_PATCH_TUI=0` 可强制文本模式。

## 特性组

按用户可见特性组织，两组互相独立、可分别应用与撤销：

| 组 | 内容 |
|---|---|
| `session-area` | 左侧边栏任意移动会话（工作区 ↔ 未分组 ↔ 归档，全向） |
| `resilience` | 坏日志不再拖垮会话列表（容错列举 + 行为验证） |

逐块声明式：官方版本已包含的修改自动识别并跳过，只补真正缺失的块；不匹配的块单独跳过并警告，
不会中止、不会破坏文件。

## 打补丁后界面获得的能力

- **拖拽组织会话**，蓝色插入条指示精确插入位置：
  - 工作区之间移动（跨目录会弹窗确认，把会话的工作目录改为目标工作区；仅支持未运行的会话）；
  - 工作区 ↔ 未分组（拖到未分组 = 移出工作区）；
  - 工作区 ↔ **归档文件夹**（拖进归档 = 归档；从归档拖到工作区/未分组 = **解除归档**并移入）；
  - 未分组 ↔ 工作区 / 归档（全向拖动）。
- **归档文件夹**常驻侧边栏，列出归档会话，方便找回；
- **未分组桶**始终有一个可见的空会话（可点开直接开始新对话，也是拖拽落点）；
- **韧性**：一个坏日志不再导致整个界面（含模型列表）打不开。

## 生效方式

- **刷新浏览器**：客户端能力立即生效（拖拽、归档文件夹、未分组锚点等）；
- **重启一次 Harness**：host 侧 RPC 生效（attach/detach、unarchive、跨目录移动、韧性）。

## 命令

```sh
dtb-harness-patch                  # 交互式全屏流程（默认）
dtb-harness-patch --status         # 只读查看各组状态
dtb-harness-patch --apply <组>     # 只应用一个组（session-area / resilience）
dtb-harness-patch --unapply <组>   # 撤销一个组（从组级备份恢复）
dtb-harness-patch --unapply-all    # 撤销全部组
dtb-harness-patch --yes            # 跳过确认询问
dtb-harness-patch --allow-unverified  # 跳过版本检测
```

## 说明

- 幂等：已打过的补丁自动跳过；修改前备份为 `<文件>.dtb-pre-<组>.bak`，撤销 = 恢复该备份；
- `npm i -g` 升级 Harness 后需重跑；版本不在已验证列表时会警告（`--allow-unverified` 跳过）。

---

## English

Apply the **session-area management patch** to an installed DeepSeek Harness with one command;
afterwards the left session area supports drag-organizing sessions (all-direction moves between
workspaces / ungrouped / archived, an archived folder, cross-directory moves, an ungrouped anchor,
and resilience to corrupt logs).

```sh
npm i -g @dsh-toolbox/harness-patch
dtb-harness-patch        # interactive: status → confirm → per-patch apply (idempotent)
```

Running with no flags starts an **interactive full-screen flow**: a per-group status table (one
line per file, with progress bars and pending/already/unmatched counts), a confirmation prompt,
then live per-patch progress; on unmatched blocks it offers *unapply / upgrade Harness / upgrade
this module*. Press `H` for help anytime. Non-TTY (pipe/CI) falls back to a plain-text flow;
`DSH_PATCH_TUI=0` forces text mode.

### Feature groups

Two independent, user-visible groups (apply/unapply separately):

| Group | What it does |
|---|---|
| `session-area` | move sessions anywhere in the left sidebar (workspace ↔ ungrouped ↔ archived, all directions) |
| `resilience` | a corrupt log no longer takes the session surface down (tolerant listing + behavioral verification) |

Applying is declarative per block: changes already present in the official build are detected and
skipped; only genuinely missing blocks are patched. A block that matches neither old nor new is
warned and skipped — never aborting, never corrupting.

Capabilities after patching:

- **Drag sessions with a blue insertion bar** at the exact position:
  - between workspaces (cross-directory moves ask for confirmation and change the session's
    working directory; only non-running sessions),
  - workspace ↔ ungrouped (drag to ungrouped = detach from the workspace),
  - workspace ↔ **archived folder** (drag in = archive; drag out to workspace/ungrouped =
    **unarchive** and move),
  - ungrouped ↔ workspace / archived (all directions).
- **Archived folder** always visible, listing archived sessions for retrieval;
- **Ungrouped bucket** always holds a visible empty session (open it to start a new conversation;
  it is also the drop anchor);
- **Resilience**: one corrupt log no longer takes the whole UI (including the model list) down.

Effect:

- **Refresh the browser** — client capabilities apply immediately;
- **Restart the Harness once** — host-side RPCs (attach/detach, unarchive, cross-directory move,
  resilience) take effect.

### Commands

```sh
dtb-harness-patch                  # interactive full-screen flow (default)
dtb-harness-patch --status         # read-only per-group state
dtb-harness-patch --apply <group>  # apply one group (session-area / resilience)
dtb-harness-patch --unapply <group># restore one group from its backup
dtb-harness-patch --unapply-all    # restore every group
dtb-harness-patch --yes            # skip the confirmation prompt
dtb-harness-patch --allow-unverified  # skip the version check
```

Notes: idempotent; files are backed up as `<file>.dtb-pre-<group>.bak` and unapply restores them;
re-run after `npm i -g` harness upgrades. The tool warns when the installed version is not in the
validated list (`--allow-unverified` to proceed anyway).

## License

MIT
