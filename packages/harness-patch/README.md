# @dsh-toolbox/harness-patch

给已安装的 DeepSeek Harness 打**会话区管理补丁**——一条命令全打包，之后在左侧会话区里拖拽整理会话
（工作区 / 未分组 / 归档 之间全向移动、归档文件夹、跨目录移动、未分组锚点、坏日志韧性）。

```sh
npm i -g @dsh-toolbox/harness-patch
dtb-harness-patch        # 应用全部补丁（幂等；升级 Harness 后重跑）
```

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

## 说明

- 幂等：已打过的补丁自动跳过；修改前自动备份原文件；应用后自校验，失败自动回滚；
- `npm i -g` 升级 Harness 后需重跑；
- 高级：如需单独重打某项，用 `--workspace-live` / `--blue-bar` / `--workspace-bundle` 等参数（见 `dtb-harness-patch --help`）。

---

## English

Apply the **session-area management patch** to an installed DeepSeek Harness with one command;
afterwards the left session area supports drag-organizing sessions (all-direction moves between
workspaces / ungrouped / archived, an archived folder, cross-directory moves, an ungrouped anchor,
and resilience to corrupt logs).

```sh
npm i -g @dsh-toolbox/harness-patch
dtb-harness-patch        # apply the full patch stack (idempotent; re-run after harness upgrades)
```

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

Notes: idempotent, auto-backed-up, self-verified with rollback on failure; re-run after `npm i -g`
harness upgrades. Advanced: apply individual patches with `--workspace-live` / `--blue-bar` /
`--workspace-bundle` etc. (see `dtb-harness-patch --help`).

## License

MIT
