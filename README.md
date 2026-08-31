# dsh-toolbox

面向 DeepSeek Harness 的**个人小工具集**（monorepo）。官方不接受外部 PR，所以我们把这些修修补补的东西做成自己的工具，按用途拆成独立插件包维护，方便自己用、也方便分发给其他 Harness 用户。

## 结构（按用途拆分）

| 包 | 用途 | 命令 |
|---|---|---|
| `packages/session-care` | 会话日志健康检查与修复：扫描每个会话日志是否符合 Harness 读端的两条契约（zstd 帧布局 + 序号连续），精确报告损坏原因，并修复可恢复的日志（帧重打包 / 去重段 / 安全截断，原文件保留、修复后先自校验再落盘） | `dsh-session-care health` / `dsh-session-care repair [--apply]` |
| `packages/harness-patch` | 已安装 Harness 的本地补丁：① 韧性补丁——会话列表对损坏日志宽容；② workspace-live——跨工作区**实时**移动会话（host `insertSessionBefore` 自动挂账 + 客户端把会话拖到工作区行，含落点高亮与移动后自动刷新）；③ ungrouped-detach——**未分组桶常驻显示**，新增 `workspace.detachSession` RPC，可把工作区里的会话拖进未分组；④ blue-bar——跨组拖拽显示**蓝色插入条**（与同组排序一致），落点即精确插入位置（可插到指定会话前/后），组头落点同样用蓝条；⑤ new-session-anchor/ungrouped-anchor——未分组桶空时**自动常驻一个空会话**（可随时点开使用，也是工作区会话拖入未分组的真实落点，自带蓝条+detach）。幂等、有备份、应用后自校验，升级 Harness 后重跑即可 | `dsh-harness-patch [--workspace-live] [--workspace-live-v2] [--ungrouped-detach] [--blue-bar] [--new-session-anchor] [--ungrouped-anchor]` |
| `packages/workspace-ops` | 会话工作区管理：把"未分组"会话移入工作区、取消归档、查看归属。直接编辑 `workspace.json`（重启后生效） | `dsh-workspace-ops list / move / unarchive` |
| `packages/core` | 共享底层：zstd 帧编解码（对齐 Harness 读端契约）、已安装 Harness 的探测 | — |

## 安装与使用

本仓库零第三方依赖（只用 Node 内置模块 + 从已安装的 Harness 里动态取 `decodeStorageRecord`），克隆后可直接用 Node 运行：

```sh
# 一键安装到 PATH（把三个命令软链到 ~/.dsh/tools/bin）
make install
# 或手动
node packages/session-care/bin/session-care.mjs health
node packages/harness-patch/bin/harness-patch.mjs
node packages/workspace-ops/bin/workspace-ops.mjs list
```

常用流程：

```sh
dsh-session-care health                    # 体检所有会话日志
dsh-session-care repair                    # 看修复计划（dry run）
dsh-session-care repair --apply            # 真正修复（原文件备份为 .corrupt-<时间戳>）
dsh-harness-patch                          # 给已安装 Harness 打韧性补丁（升级后重跑）
dsh-harness-patch --workspace-live         # 实时跨工作区移动（拖拽会话到工作区行）
dsh-harness-patch --workspace-live-v2      # 落点高亮 + 移动后自动展开/刷新（无需重启）
dsh-harness-patch --ungrouped-detach       # 未分组桶常驻 + 拖出工作区到未分组（host 需重启一次）
dsh-harness-patch --blue-bar               # 跨组拖拽用蓝色插入条指示精确插入位置
dsh-harness-patch --new-session-anchor     # 未分组桶下"＋ 新会话"锚点（点击创建 + 拖拽落点）
dsh-harness-patch --ungrouped-anchor       # 改为：空桶自动常驻一个空会话（可点开使用，也是拖拽落点）
dsh-workspace-ops move <sessionId> --workspace appilot
dsh-workspace-ops unarchive <sessionId>
```

## 为什么移动会话到工作区需要重启？能不能实时？

`workspace.json` 由 Harness 在**启动时一次性读入内存**，内存态是权威：所有写操作都经过
domain 的 write chain 修改内存再整体重写文件；**没有文件热重载**，也**没有"把已有会话挂账
到工作区"的 RPC**（`attachSession` 只在创建/派生会话时被 host 内部调用）。所以直接编辑
文件不会被运行中的进程感知，下一次工作区写操作还会用内存态把编辑覆盖掉——这就是要重启的
原因。

**实时化是可行的**：`harness-patch --workspace-live` 在 host 侧给 `workspace.insertSessionBefore`
加了"先挂账（header cwd 匹配时）再移动"的逻辑，并在客户端新增"把会话（含未分组）拖到工作区行"
的落点。客户端补丁由运行中的服务直接按新文件提供（刷新浏览器即生效）；host 侧补丁**重启一次**
后，拖拽移动就是实时的，之后不再需要任何重启。

## 发给别人用（插件/分发）

每个包都是标准 npm 包形状（`package.json` + `bin`），发布到 npm 后其他人可以直接：

```sh
npm i -g @dsh-toolbox/session-care @dsh-toolbox/harness-patch @dsh-toolbox/workspace-ops
```

> 注：发布前需把对 `packages/core` 的相对引用改成对 `@dsh-toolbox/core` 的依赖（core 也要发布）。工具定位是**离线/CLI 运维**（日志损坏时 Harness 往往已经不能正常加载，在线插件帮不上忙），所以暂不做 Cordis 运行时插件；如需 GUI 内入口（如 `/repair-session` 斜杠命令），可作为后续独立插件包，在 Harness 可正常加载时提供界面入口。

## 文档

- [事故复盘与修复手册](docs/playbook-session-corruption.md) — 2026-08 会话日志损坏事故的完整复盘：根因、判定方法、修复步骤、为什么"坏日志会拖垮整个界面"。

## 许可

MIT
