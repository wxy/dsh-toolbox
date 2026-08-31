# dsh-toolbox

面向 DeepSeek Harness 的**小工具集**，两个命令行组件：

1. **`dtb-session-care`** —— 会话日志损坏时，Harness 可能打不开/无法运行；用它体检并修复（离线 CLI）。
2. **`dtb-harness-patch`** —— 给 Harness 打**会话区管理补丁**：在界面里拖拽整理会话（工作区 / 未分组 / 归档 之间全向移动）、归档文件夹、跨目录移动、坏日志不再拖垮整个界面。

## 安装（npm，推荐）

```sh
npm i -g @dsh-toolbox/session-care @dsh-toolbox/harness-patch
```

## 使用

```sh
dtb-session-care health              # 体检所有会话日志（默认根 ~/.dsh/sessions）
dtb-session-care repair --apply      # 修复损坏日志（原文件保留为 .corrupt-<时间戳>）
dtb-harness-patch                    # 一条命令应用全部会话区补丁（幂等；升级 Harness 后重跑）
```

`dtb-harness-patch` 应用后：**刷新浏览器**（拖拽、归档文件夹等客户端能力立即生效）+ **重启一次 Harness**（host 侧 RPC 生效）。

| 包 | 用途 | 命令 |
|---|---|---|
| `@dsh-toolbox/session-care` | 会话日志健康检查与修复（离线） | `dtb-session-care` |
| `@dsh-toolbox/harness-patch` | 会话区管理补丁（界面能力） | `dtb-harness-patch` |

> `@dsh-toolbox/core` 是两个组件的共享底层，无需直接安装。

## 开发者 / 贡献（克隆仓库）

```sh
git clone https://github.com/wxy/dsh-toolbox.git
cd dsh-toolbox
make install        # 链接命令到 ~/.dsh/tools/bin
```

- [事故复盘与修复手册](docs/playbook-session-corruption.md)
- 许可：MIT

---

## English

A small toolbox for the DeepSeek Harness with two CLI packages:

1. **`dtb-session-care`** — a corrupt session log can keep the whole Harness from starting;
   health-check and repair logs (offline CLI).
2. **`dtb-harness-patch`** — apply the **session-area management patch**: drag sessions between
   workspaces / ungrouped / archived (all directions), an archived folder, cross-directory moves,
   and resilience so one corrupt log no longer takes the whole UI down.

## Install (npm)

```sh
npm i -g @dsh-toolbox/session-care @dsh-toolbox/harness-patch
```

## Usage

```sh
dtb-session-care health              # scan every session log (default root ~/.dsh/sessions)
dtb-session-care repair --apply      # repair corrupt logs (originals kept as .corrupt-<ts>)
dtb-harness-patch                    # apply the full session-area patch (idempotent; re-run after harness upgrades)
```

After `dtb-harness-patch`: **refresh the browser** (client capabilities: drag-organization,
archived folder, etc. apply immediately) + **restart the Harness once** (host-side RPCs).

| package | purpose | command |
|---|---|---|
| `@dsh-toolbox/session-care` | session-log health check & repair (offline) | `dtb-session-care` |
| `@dsh-toolbox/harness-patch` | session-area management patch (UI capabilities) | `dtb-harness-patch` |

> `@dsh-toolbox/core` is shared internals for both — no need to install directly.

## Developers / Contributing (clone the repo)

```sh
git clone https://github.com/wxy/dsh-toolbox.git
cd dsh-toolbox
make install        # links the commands into ~/.dsh/tools/bin
```

- [Incident postmortem & repair playbook](docs/playbook-session-corruption.md)
- License: MIT
