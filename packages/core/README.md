# @dsh-toolbox/core

dsh-toolbox 工具集的**共享底层库**（零第三方依赖，纯 Node ESM）。供
[`@dsh-toolbox/session-care`](https://www.npmjs.com/package/@dsh-toolbox/session-care) 与
[`@dsh-toolbox/harness-patch`](https://www.npmjs.com/package/@dsh-toolbox/harness-patch) 内部使用，
**不提供命令行**。

- `src/frames.mjs` — zstd 帧编解码，严格对齐 DeepSeek Harness 读端契约：每个帧独立可解、带校验和，且**第一个帧必须恰好是 header 一行**；
- `src/harness.mjs` — 定位已安装的 DeepSeek Harness（`DSH_INSTALL` 环境变量 / `npm root -g` 自动探测），并动态取 `decodeStorageRecord` 用于解析打包行。

---

## English

Shared low-level pieces for the [dsh-toolbox](https://github.com/wxy/dsh-toolbox) utilities.
Zero third-party dependencies, plain Node ESM. Used internally by
[`@dsh-toolbox/session-care`](https://www.npmjs.com/package/@dsh-toolbox/session-care) and
[`@dsh-toolbox/harness-patch`](https://www.npmjs.com/package/@dsh-toolbox/harness-patch).
**No CLI is provided.**

- `src/frames.mjs` — Zstandard frame codec matching the DeepSeek Harness reader contract:
  every frame independently decodable with a checksum, and the **first frame must be exactly
  the header line**;
- `src/harness.mjs` — locates the installed DeepSeek Harness (`DSH_INSTALL` env / `npm root -g`
  auto-detection) and lazily loads `decodeStorageRecord` for packed rows.

## License

MIT
