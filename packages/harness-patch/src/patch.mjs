/**
 * The local resilience patch for the installed dsh-session-persistence-jsonl
 * build: one corrupt session log must not take the whole session surface down.
 * Idempotent; the original is preserved at `index.js.pre-resilience.bak`.
 * Re-apply after every harness upgrade (`npm i -g` or dsh reinstall).
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MARKER = 'async listWithCorruption'

const OLD_BLOCK = `	async list(signal) {
		return (await this.listArtifacts(signal)).map((artifact) => artifact.header);
	}
	/** List metadata plus a stat-derived identity for each append-only log. */
	async listSnapshots(signal) {
		const snapshots = [];
		for (const artifact of await this.listArtifacts(signal)) {
			signal?.throwIfAborted();
			try {
				const identity = await stat(artifact.path, { bigint: true });
				signal?.throwIfAborted();
				snapshots.push({
					header: artifact.header,
					revision: fileRevision(identity)
				});
			} catch (error) {
				signal?.throwIfAborted();
				if (!isENOENT(error)) throw error;
			}
		}
		signal?.throwIfAborted();
		return snapshots;
	}
	async listArtifacts(signal) {
		signal?.throwIfAborted();
		await this.ensureRootEncoding();
		signal?.throwIfAborted();
		const artifacts = [];
		const ids = /* @__PURE__ */ new Set();
		for (const project of await this.listProjectDirs(signal)) {
			signal?.throwIfAborted();
			for (const dir of await this.listSessionDirs(project, signal)) {
				signal?.throwIfAborted();
				const opposite = join(dir, \`session\${logSuffix(this.oppositeCompression())}\`);
				const oppositeExists = await this.exists(opposite);
				signal?.throwIfAborted();
				if (oppositeExists) throw this.encodingMismatch(opposite);
				const path = join(dir, \`session\${logSuffix(this.compression)}\`);
				const pathExists = await this.exists(path);
				signal?.throwIfAborted();
				if (!pathExists) continue;
				const first = this.compression === "zstd" ? await this.readFirstZstdLine(path, signal) : await this.readFirstLine(path, signal);
				signal?.throwIfAborted();
				if (first === void 0) continue;
				const meta = parseHeaderMeta(first);
				if (meta === void 0) continue;
				await this.assertStoredIdentity(path, meta, void 0, signal);
				signal?.throwIfAborted();
				if (ids.has(meta.id)) throw new Error(\`duplicate JSONL session id "\${meta.id}" appears in multiple project directories\`);
				ids.add(meta.id);
				artifacts.push({
					header: meta,
					path
				});
			}
		}
		signal?.throwIfAborted();
		return artifacts;
	}`

const NEW_BLOCK = `	async list(signal) {
		return (await this.listWithCorruption(signal)).headers;
	}
	/** List metadata plus a stat-derived identity for each append-only log. */
	async listSnapshots(signal) {
		const snapshots = [];
		for (const artifact of (await this.listArtifacts(signal)).artifacts) {
			signal?.throwIfAborted();
			try {
				const identity = await stat(artifact.path, { bigint: true });
				signal?.throwIfAborted();
				snapshots.push({
					header: artifact.header,
					revision: fileRevision(identity)
				});
			} catch (error) {
				signal?.throwIfAborted();
				if (!isENOENT(error)) throw error;
			}
		}
		signal?.throwIfAborted();
		return snapshots;
	}
	/**
	* Tolerant listing: healthy headers plus damaged artifacts, so one corrupt
	* session log never takes the whole session surface (sidebar, projections,
	* model-list bootstrap) down with it.
	* @returns healthy headers plus the corrupt entries reported separately.
	*/
	async listWithCorruption(signal) {
		const { artifacts, corrupt } = await this.listArtifacts(signal);
		return { headers: artifacts.map((artifact) => artifact.header), corrupt };
	}
	/** Session artifacts excluded from list() because they failed validation. */
	async listCorrupt(signal) {
		return (await this.listArtifacts(signal)).corrupt;
	}
	async listArtifacts(signal) {
		signal?.throwIfAborted();
		await this.ensureRootEncoding();
		signal?.throwIfAborted();
		const artifacts = [];
		const corrupt = [];
		const ids = /* @__PURE__ */ new Set();
		for (const project of await this.listProjectDirs(signal)) {
			signal?.throwIfAborted();
			for (const dir of await this.listSessionDirs(project, signal)) {
				signal?.throwIfAborted();
				const opposite = join(dir, \`session\${logSuffix(this.oppositeCompression())}\`);
				const oppositeExists = await this.exists(opposite);
				signal?.throwIfAborted();
				if (oppositeExists) throw this.encodingMismatch(opposite);
				const path = join(dir, \`session\${logSuffix(this.compression)}\`);
				const pathExists = await this.exists(path);
				signal?.throwIfAborted();
				if (!pathExists) continue;
				let first;
				let meta;
				try {
					first = this.compression === "zstd" ? await this.readFirstZstdLine(path, signal) : await this.readFirstLine(path, signal);
					signal?.throwIfAborted();
					if (first === void 0) continue;
					meta = parseHeaderMeta(first);
					if (meta === void 0) continue;
					await this.assertStoredIdentity(path, meta, void 0, signal);
					signal?.throwIfAborted();
				} catch (error) {
					// One bad artifact must not take the whole session surface
					// down: record it and keep listing the rest. Duplicate ids
					// are decided below, OUTSIDE this tolerance, because they
					// violate a storage invariant, not one artifact's readability.
					signal?.throwIfAborted();
					corrupt.push({ path, error: error instanceof Error ? error : new Error(String(error)) });
					continue;
				}
				if (ids.has(meta.id)) throw new Error(\`duplicate JSONL session id "\${meta.id}" appears in multiple project directories\`);
				ids.add(meta.id);
				artifacts.push({
					header: meta,
					path
				});
			}
		}
		signal?.throwIfAborted();
		return { artifacts, corrupt };
	}`

/** Apply the resilience patch to one dsh install; returns a status object. */
export async function applyResiliencePatch(dshInstall) {
  const target = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')
  if (!existsSync(target)) throw new Error(`installed persistence lib not found: ${target}`)
  const original = readFileSync(target, 'utf8')
  if (original.includes(MARKER)) {
    return { alreadyPatched: true, target }
  }
  if (!original.includes(OLD_BLOCK)) {
    throw new Error('the installed lib does not match the expected listing block — the build changed; aborting without touching it')
  }
  const backup = `${target}.pre-resilience.bak`
  if (!existsSync(backup)) copyFileSync(target, backup)
  writeFileSync(target, original.replace(OLD_BLOCK, NEW_BLOCK))

  // Behavioral verification in a fresh process against a fixture root.
  const probeDir = mkdtempSync(join(tmpdir(), 'dsh-toolbox-patch-probe-'))
  try {
    const probe = buildProbe(dshInstall, target)
    const probeFile = join(probeDir, 'probe.mjs')
    writeFileSync(probeFile, probe)
    const { spawnSync } = await import('node:child_process')
    const result = spawnSync(process.execPath, [probeFile], { encoding: 'utf8' })
    if (result.status !== 0) {
      copyFileSync(backup, target)
      throw new Error(`patch verification failed; rolled back.\n${result.stderr || result.stdout}`)
    }
    return { applied: true, backup, target, verified: result.stdout.trim() }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

function buildProbe(dshInstall, target) {
  const url = pathToFileURL(target).href
  const cordisUrl = pathToFileURL(join(dshInstall, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')).href
  const sessionUrl = pathToFileURL(join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')).href
  return `import { pathToFileURL } from 'node:url'
const url = ${JSON.stringify(url)}
const { default: JsonlSessionPersistence } = await import(url)
const { Context } = await import(${JSON.stringify(cordisUrl)})
const { default: SessionStore } = await import(${JSON.stringify(sessionUrl)})
const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const root = await mkdtemp(join(tmpdir(), 'dsh-patch-probe-'))
try {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
  const backend = ctx.sessionPersistence
  await backend.create({ version: 0, id: 'session-healthy', createdAt: 1, cwd: '/tmp', delegationDepth: 0 })
  await backend.append('session-healthy', [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const badDir = join(root, '--tmp--', 'session-bad')
  await mkdir(badDir, { recursive: true })
  await writeFile(join(badDir, 'session.jsonl.zstd'), Buffer.from('this is not a zstd frame at all'))
  const headers = await backend.list()
  if (headers.length !== 1 || headers[0].id !== 'session-healthy') throw new Error('list() failed: ' + JSON.stringify(headers))
  const { headers: h2, corrupt } = await backend.listWithCorruption()
  if (h2.length !== 1 || corrupt.length !== 1) throw new Error('listWithCorruption mismatch')
  if (!corrupt[0].path.endsWith('session-bad/session.jsonl.zstd')) throw new Error('corrupt path mismatch')
  if ((await backend.listCorrupt()).length !== 1) throw new Error('listCorrupt mismatch')
  console.log('PATCH VERIFIED: list() tolerates the corrupt sibling; listWithCorruption()/listCorrupt() report it')
} finally {
  await rm(root, { recursive: true, force: true })
}`
}

// --- workspace-live patch: real-time cross-workspace session moves ----------

const WORKSPACE_LIVE_MARKER = 'dsh-toolbox workspace-live'

const HOST_OLD = `			async insertSessionBefore(request) {
				const { payload } = request;
				const workspace = ctx.workspaceRegistry.get(WorkspaceId(payload.workspaceId));
				if (workspace === void 0) return workspaceNotFound(request, payload.workspaceId);
				try {
					await workspace.insertSessionBefore(payload.sessionId, payload.beforeSessionId);
				} catch (error) {`

const HOST_NEW = `			async insertSessionBefore(request) {
				const { payload } = request;
				const workspace = ctx.workspaceRegistry.get(WorkspaceId(payload.workspaceId));
				if (workspace === void 0) return workspaceNotFound(request, payload.workspaceId);
				try {
					// dsh-toolbox workspace-live: attach an unaccounted session
					// first when its header cwd matches this workspace, so a
					// session can be moved across groups in real time. A cwd
					// mismatch falls through to the not-accounted rejection.
					try {
						await workspace.attachSession(payload.sessionId);
					} catch {
						// header cwd mismatch or unreadable: leave it unaccounted
					}
					await workspace.insertSessionBefore(payload.sessionId, payload.beforeSessionId);
				} catch (error) {`

const CLIENT_INSERT_OLD = `			};
			const commitWorkspaceDrag = (activeDrag, over) => {`

const CLIENT_INSERT_NEW = `			};
			const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				insertSessionBefore(workspaceId, activeDrag.sessionId, void 0).catch((reason) => {
					console.warn("session move rejected:", reason);
				});
			};
			const commitWorkspaceDrag = (activeDrag, over) => {`

const CLIENT_DROP_OLD = `								onDragOver: workspaceDrag === null || hoverWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									hoverWorkspace(workspaceGroupHalf(e));
								},
								onDrop: workspaceDrag === null || dropWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									dropWorkspace(workspaceGroupHalf(e));
								},`

const CLIENT_DROP_NEW = `								onDragOver: (workspaceDrag === null && drag === null) || hoverWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									hoverWorkspace(workspaceGroupHalf(e));
								},
								onDrop: (workspaceDrag === null && drag === null) || dropWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									if (drag !== null && workspaceId !== void 0) {
										commitSessionToWorkspaceDrag(drag, workspaceId);
									} else {
										dropWorkspace(workspaceGroupHalf(e));
									}
								},`

/**
 * Enable real-time cross-workspace session moves on an installed harness:
 *  - host (dsh-host-apiproxy): workspace.insertSessionBefore now attaches an
 *    unaccounted session first (header cwd must match the target workspace),
 *    so moving a session into a workspace works live instead of failing with
 *    "not accounted";
 *  - client (dsh-client-ui-workspace): dragging a session (incl. from the
 *    ungrouped bucket) onto a workspace row now calls insertSessionBefore.
 * Idempotent; both files backed up; re-apply after harness upgrades.
 */
export async function applyWorkspaceLivePatch(dshInstall) {
  const hostTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  const results = []
  for (const target of [hostTarget, clientTarget]) {
    if (!existsSync(target)) throw new Error(`workspace-live target not found: ${target}`)
  }
  const hostOriginal = readFileSync(hostTarget, 'utf8')
  if (!hostOriginal.includes(WORKSPACE_LIVE_MARKER)) {
    if (!hostOriginal.includes(HOST_OLD)) {
      throw new Error(`host apiproxy build changed; workspace-live host patch aborted without touching ${hostTarget}`)
    }
    const backup = `${hostTarget}.pre-workspace-live.bak`
    if (!existsSync(backup)) copyFileSync(hostTarget, backup)
    writeFileSync(hostTarget, hostOriginal.replace(HOST_OLD, HOST_NEW))
    results.push({ file: hostTarget, backup, changed: true })
  } else {
    results.push({ file: hostTarget, alreadyPatched: true })
  }

  const clientOriginal = readFileSync(clientTarget, 'utf8')
  if (!clientOriginal.includes(WORKSPACE_LIVE_MARKER)) {
    if (!clientOriginal.includes(CLIENT_INSERT_OLD) || !clientOriginal.includes(CLIENT_DROP_OLD)) {
      throw new Error(`client build changed; workspace-live client patch aborted without touching ${clientTarget}`)
    }
    const backup = `${clientTarget}.pre-workspace-live.bak`
    if (!existsSync(backup)) copyFileSync(clientTarget, backup)
    let next = clientOriginal
    next = next.replace(CLIENT_INSERT_OLD, CLIENT_INSERT_NEW)
    next = next.replace(CLIENT_DROP_OLD, CLIENT_DROP_NEW)
    writeFileSync(clientTarget, next)
    results.push({ file: clientTarget, backup, changed: true })
  } else {
    results.push({ file: clientTarget, alreadyPatched: true })
  }
  return results
}

// --- workspace-live v2: drop feedback + live list update --------------------

const WORKSPACE_LIVE_V2_MARKER = 'dsh-toolbox workspace-live-v2'

const V2_STATE_OLD = `			const [drag, setDrag] = (0, react.useState)(null);
			const sessionDropCommitted = (0, react.useRef)(false);`

const V2_STATE_NEW = `			const [drag, setDrag] = (0, react.useState)(null);
			const sessionDropCommitted = (0, react.useRef)(false);
			const [sessionDropMarker, setSessionDropMarker] = (0, react.useState)(null);`

const V2_COMMIT_OLD = `			const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				insertSessionBefore(workspaceId, activeDrag.sessionId, void 0).catch((reason) => {
					console.warn("session move rejected:", reason);
				});
			};`

const V2_COMMIT_NEW = `			const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				insertSessionBefore(workspaceId, activeDrag.sessionId, void 0).then(() => {
					setGroupExpanded(workspaceId, true);
				}).catch((reason) => {
					console.warn("session move rejected:", reason);
					try { alert("移动会话失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};`

const V2_CLASS_OLD = `							return (0, react_jsx_runtime.jsxs)("div", {
								className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter),`

const V2_CLASS_NEW = `							return (0, react_jsx_runtime.jsxs)("div", {
								className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter, sessionDropMarker !== null && sessionDropMarker.id === workspaceId && (sessionDropMarker.half === "before" ? WorkspaceBrowser_module_css_default.workspaceDropBefore : WorkspaceBrowser_module_css_default.workspaceDropAfter)),`

const V2_DRAGOVER_OLD = `								onDragOver: (workspaceDrag === null && drag === null) || hoverWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									hoverWorkspace(workspaceGroupHalf(e));
								},`

const V2_DRAGOVER_NEW = `								onDragOver: (workspaceDrag === null && drag === null) || hoverWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									if (drag !== null && workspaceId !== void 0) {
										setSessionDropMarker({ id: workspaceId, half: workspaceGroupHalf(e) });
									} else {
										hoverWorkspace(workspaceGroupHalf(e));
									}
								},`

const V2_DRAGSTART_OLD = `												start: () => {
													sessionDropCommitted.current = false;
													setDrag({
														accountKey: group.key,
														sessionId: node.id,
														over: null
													});
												},`

const V2_DRAGSTART_NEW = `												start: () => {
													sessionDropCommitted.current = false;
													setSessionDropMarker(null);
													setDrag({
														accountKey: group.key,
														sessionId: node.id,
														over: null
													});
												},`

const V2_DRAGEND_OLD = `												end: () => {
													if (drag?.over !== null && drag?.over !== void 0) commitSessionDrag(drag, drag.over);
													else setDrag(null);
													sessionDropCommitted.current = false;
												}`

const V2_DRAGEND_NEW = `												end: () => {
													if (drag?.over !== null && drag?.over !== void 0) commitSessionDrag(drag, drag.over);
													else setDrag(null);
													setSessionDropMarker(null);
													sessionDropCommitted.current = false;
												}`

const V2_REFRESH_OLD = `				insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
					await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
				},`

const V2_REFRESH_NEW = `				insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
					await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

/**
 * workspace-live v2: drop feedback + live sidebar update. Requires the v1
 * patch. Adds: a drop-highlight on the target workspace row while a session
 * drag hovers it, target-group expansion + a forced workspace-list refresh
 * after a successful move (so the result is visible immediately, no page
 * refresh), a visible alert on failure, and marker cleanup on drag start/end.
 */
export async function applyWorkspaceLivePatchV2(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`workspace-live v2 target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(WORKSPACE_LIVE_V2_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  if (!original.includes('const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {')) {
    throw new Error('workspace-live v1 is not applied; run --workspace-live first')
  }
  const pairs = [
    [V2_STATE_OLD, V2_STATE_NEW],
    [V2_COMMIT_OLD, V2_COMMIT_NEW],
    [V2_CLASS_OLD, V2_CLASS_NEW],
    [V2_DRAGOVER_OLD, V2_DRAGOVER_NEW],
    [V2_DRAGSTART_OLD, V2_DRAGSTART_NEW],
    [V2_DRAGEND_OLD, V2_DRAGEND_NEW],
    [V2_REFRESH_OLD, V2_REFRESH_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('workspace-live v2: a v1 text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-workspace-live-v2.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  // marker: annotate the v2 commit function so idempotence is content-based
  writeFileSync(clientTarget, next.replace(
    'const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {',
    `// dsh-toolbox workspace-live-v2\n\t\t\tconst commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {`,
  ))
  return [{ file: clientTarget, backup, changed: true }]
}

// --- ungrouped detach patch (v3): drag sessions OUT of workspaces -----------

const DETACH_MARKER = 'dsh-toolbox ungrouped-detach'

const DETACH_HOST_CMD_OLD = `				return ok(request, { workspace: workspaceView(workspace) });
			},
			async archiveSession(request) {`

const DETACH_HOST_CMD_NEW = `				return ok(request, { workspace: workspaceView(workspace) });
			},
			async detachSession(request) {
				const { payload } = request;
				const workspace = ctx.workspaceRegistry.get(WorkspaceId(payload.workspaceId));
				if (workspace === void 0) return workspaceNotFound(request, payload.workspaceId);
				await workspace.detachSession(payload.sessionId);
				return ok(request, { workspace: workspaceView(workspace) });
			},
			async archiveSession(request) {`

const DETACH_HOST_SCHEMA_OLD = `/** workspace.insertSessionBefore response value. */
const workspaceInsertSessionBeforeValueSchema = z$1.object({ workspace: workspaceViewSchema });`

const DETACH_HOST_SCHEMA_NEW = `/** workspace.insertSessionBefore response value. */
const workspaceInsertSessionBeforeValueSchema = z$1.object({ workspace: workspaceViewSchema });
/** workspace.detachSession request payload (dsh-toolbox ungrouped-detach). */
const workspaceDetachSessionRequestSchema = z$1.object({
	workspaceId: workspaceIdSchema,
	sessionId: sessionIdSchema
});
/** workspace.detachSession response value (dsh-toolbox ungrouped-detach). */
const workspaceDetachSessionValueSchema = z$1.object({ workspace: workspaceViewSchema });`

const DETACH_HOST_REGISTRY_OLD = `		invoke: (api, r) => api.workspace.insertSessionBefore(r)
	},
	"workspace.archiveSession": {`

const DETACH_HOST_REGISTRY_NEW = `		invoke: (api, r) => api.workspace.insertSessionBefore(r)
	},
	"workspace.detachSession": {
		schema: workspaceDetachSessionRequestSchema,
		invoke: (api, r) => api.workspace.detachSession(r)
	},
	"workspace.archiveSession": {`

const DETACH_HOST_VALUE_MAP_OLD = `	"workspace.insertSessionBefore": workspaceInsertSessionBeforeValueSchema,
	"workspace.archiveSession": workspaceArchiveSessionValueSchema,`

const DETACH_HOST_VALUE_MAP_NEW = `	"workspace.insertSessionBefore": workspaceInsertSessionBeforeValueSchema,
	"workspace.detachSession": workspaceDetachSessionValueSchema,
	"workspace.archiveSession": workspaceArchiveSessionValueSchema,`

const DETACH_CLIENT_STRAY_OLD = `			if (stray.length > 0) groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));`

const DETACH_CLIENT_STRAY_NEW = `			// dsh-toolbox ungrouped-detach: the ungrouped bucket is always
			// rendered so it can serve as a drop target for moving sessions out
			// of a workspace (detaching). An empty bucket just shows the header.
			groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));`

const DETACH_CLIENT_MARKER_OLD = `sessionDropMarker !== null && sessionDropMarker.id === workspaceId && (sessionDropMarker.half === "before" ? WorkspaceBrowser_module_css_default.workspaceDropBefore : WorkspaceBrowser_module_css_default.workspaceDropAfter)),`

const DETACH_CLIENT_MARKER_NEW = `sessionDropMarker !== null && sessionDropMarker.id === group.key && (sessionDropMarker.half === "before" ? WorkspaceBrowser_module_css_default.workspaceDropBefore : WorkspaceBrowser_module_css_default.workspaceDropAfter)),`

const DETACH_CLIENT_DROP_OLD = `								onDragOver: (workspaceDrag === null && drag === null) || hoverWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									if (drag !== null && workspaceId !== void 0) {
										setSessionDropMarker({ id: workspaceId, half: workspaceGroupHalf(e) });
									} else {
										hoverWorkspace(workspaceGroupHalf(e));
									}
								},
								onDrop: (workspaceDrag === null && drag === null) || dropWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									if (drag !== null && workspaceId !== void 0) {
										commitSessionToWorkspaceDrag(drag, workspaceId);
									} else {
										dropWorkspace(workspaceGroupHalf(e));
									}
								},`

const DETACH_CLIENT_DROP_NEW = `								onDragOver: drag !== null || (workspaceDrag !== null && workspaceId !== void 0) ? (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									if (drag !== null) {
										setSessionDropMarker({ id: group.key, half: "after" });
									} else {
										hoverWorkspace(workspaceGroupHalf(e));
									}
								} : void 0,
								onDrop: drag !== null || (workspaceDrag !== null && workspaceId !== void 0) ? (e) => {
									e.preventDefault();
									if (drag !== null) {
										if (workspaceId !== void 0) commitSessionToWorkspaceDrag(drag, workspaceId);
										else commitSessionToUngroupedDrag(drag);
									} else {
										dropWorkspace(workspaceGroupHalf(e));
									}
								} : void 0,`

const DETACH_CLIENT_UNGROUPED_FN_OLD = `					console.warn("session move rejected:", reason);
					try { alert("移动会话失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};`

const DETACH_CLIENT_UNGROUPED_FN_NEW = `					console.warn("session move rejected:", reason);
					try { alert("移动会话失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};
			const commitSessionToUngroupedDrag = (activeDrag) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				const owner = workspaces.find((workspace) => workspace.sessionIds.includes(activeDrag.sessionId));
				if (owner === void 0) return;
				detachSession(owner.workspaceId, activeDrag.sessionId).catch((reason) => {
					console.warn("session detach rejected:", reason);
					try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};`

const DETACH_CLIENT_ST_PROPS_OLD = `function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t }) {`

const DETACH_CLIENT_ST_PROPS_NEW = `function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, detachSession, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t }) {`

const DETACH_CLIENT_WB_PROPS_OLD = `function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostDescription, renderSlot, t }) {`

const DETACH_CLIENT_WB_PROPS_NEW = `function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, detachSession, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostDescription, renderSlot, t }) {`

const DETACH_CLIENT_WB_RENDER_OLD = `							insertWorkspaceBefore,
							insertSessionBefore,
							orderBy,`

const DETACH_CLIENT_WB_RENDER_NEW = `							insertWorkspaceBefore,
							insertSessionBefore,
							detachSession,
							orderBy,`

const DETACH_CLIENT_INJECT_OLD = `				insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
					await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

const DETACH_CLIENT_INJECT_NEW = `				insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
					await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},
				detachSession: async (workspaceId, sessionId) => {
					const result = await ctx.get("connection").rpc.call("/api", "workspace.detachSession", { args: { workspaceId, sessionId } }, void 0);
					if (!result.ok) throw new Error('workspace detach failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

/**
 * ungrouped-detach (v3): let sessions be dragged OUT of a workspace into the
 * (now always-present) ungrouped bucket. Requires v1+v2.
 *  - host: new workspace.detachSession RPC (domain detachSession exists)
 *  - client: the ungrouped bucket is always rendered so it is a drop target;
 *    dropping a workspace session on it calls detach + refresh; the drop
 *    highlight is keyed by group so the ungrouped row lights up too.
 */
export async function applyUngroupedDetachPatch(dshInstall) {
  const hostTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  for (const target of [hostTarget, clientTarget]) {
    if (!existsSync(target)) throw new Error(`ungrouped-detach target not found: ${target}`)
  }
  const results = []

  const hostOriginal = readFileSync(hostTarget, 'utf8')
  if (!hostOriginal.includes(DETACH_MARKER)) {
    const hostPairs = [
      [DETACH_HOST_CMD_OLD, DETACH_HOST_CMD_NEW],
      [DETACH_HOST_SCHEMA_OLD, DETACH_HOST_SCHEMA_NEW],
      [DETACH_HOST_REGISTRY_OLD, DETACH_HOST_REGISTRY_NEW],
      [DETACH_HOST_VALUE_MAP_OLD, DETACH_HOST_VALUE_MAP_NEW],
    ]
    for (const [oldText] of hostPairs) {
      if (!hostOriginal.includes(oldText)) throw new Error('ungrouped-detach: host build changed; aborting')
    }
    const backup = `${hostTarget}.pre-ungrouped-detach.bak`
    if (!existsSync(backup)) copyFileSync(hostTarget, backup)
    let next = hostOriginal
    for (const [oldText, newText] of hostPairs) next = next.replace(oldText, newText)
    writeFileSync(hostTarget, next)
    results.push({ file: hostTarget, backup, changed: true })
  } else {
    results.push({ file: hostTarget, alreadyPatched: true })
  }

  const clientOriginal = readFileSync(clientTarget, 'utf8')
  if (!clientOriginal.includes(DETACH_MARKER)) {
    if (!clientOriginal.includes('const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {')) {
      throw new Error('ungrouped-detach: workspace-live v1 is not applied; run --workspace-live first')
    }
    const clientPairs = [
      [DETACH_CLIENT_STRAY_OLD, DETACH_CLIENT_STRAY_NEW],
      [DETACH_CLIENT_MARKER_OLD, DETACH_CLIENT_MARKER_NEW],
      [DETACH_CLIENT_DROP_OLD, DETACH_CLIENT_DROP_NEW],
      [DETACH_CLIENT_UNGROUPED_FN_OLD, DETACH_CLIENT_UNGROUPED_FN_NEW],
      [DETACH_CLIENT_ST_PROPS_OLD, DETACH_CLIENT_ST_PROPS_NEW],
      [DETACH_CLIENT_WB_PROPS_OLD, DETACH_CLIENT_WB_PROPS_NEW],
      [DETACH_CLIENT_WB_RENDER_OLD, DETACH_CLIENT_WB_RENDER_NEW],
      [DETACH_CLIENT_INJECT_OLD, DETACH_CLIENT_INJECT_NEW],
    ]
    for (const [oldText] of clientPairs) {
      if (!clientOriginal.includes(oldText)) throw new Error('ungrouped-detach: a client text block no longer matches; aborting')
    }
    const backup = `${clientTarget}.pre-ungrouped-detach.bak`
    if (!existsSync(backup)) copyFileSync(clientTarget, backup)
    let next = clientOriginal
    for (const [oldText, newText] of clientPairs) next = next.replace(oldText, newText)
    writeFileSync(clientTarget, next)
    results.push({ file: clientTarget, backup, changed: true })
  } else {
    results.push({ file: clientTarget, alreadyPatched: true })
  }
  return results
}

// --- blue-bar cross-group drag (v4): insertion bar, not highlight -----------

const BLUEBAR_MARKER = 'dsh-toolbox blue-bar-drag'

const B4_HOVER_OLD = `												hover: (half) => {
													/* v8 ignore next -- narrowing guard: Rows gates hover on \`active\`, which is false while the drag state is null. */
													setDrag((d) => d === null ? d : {
														...d,
														over: {
															id: node.id,
															half
														}
													});
												},`

const B4_HOVER_NEW = `												hover: (half) => {
													setDrag((d) => d === null ? d : {
														...d,
														over: {
															id: node.id,
															half,
															accountKey: group.key
														}
													});
												},`

const B4_MARKER_OLD = `												marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,`

const B4_MARKER_NEW = `												marker: drag !== null && drag.over?.id === node.id ? drag.over.half : null,`

const B4_DROP_OLD = `												drop: (half) => {
													/* v8 ignore next -- narrowing guard: Rows gates drop on \`active\`, which is false while the drag state is null. */
													if (drag === null) return;
													commitSessionDrag(drag, {
														id: node.id,
														half
													});
												},`

const B4_DROP_NEW = `												drop: (half) => {
													if (drag === null) return;
													if (drag.accountKey === group.key) commitSessionDrag(drag, {
														id: node.id,
														half
													});
													else commitSessionCrossGroupDrag(drag, {
														id: node.id,
														half,
														accountKey: group.key
													});
												},`

const B4_END_OLD = `												end: () => {
													if (drag?.over !== null && drag?.over !== void 0) commitSessionDrag(drag, drag.over);
													else setDrag(null);
													setSessionDropMarker(null);
													sessionDropCommitted.current = false;
												}`

const B4_END_NEW = `												end: () => {
													if (drag?.over !== null && drag?.over !== void 0 && drag.over.accountKey === drag.accountKey) commitSessionDrag(drag, drag.over);
													else if (drag?.over !== null && drag?.over !== void 0) commitSessionCrossGroupDrag(drag, drag.over);
													else setDrag(null);
													setSessionDropMarker(null);
													sessionDropCommitted.current = false;
												}`

const B4_ROWGATE_OLD = `					onDragOver: drag === void 0 ? void 0 : (e) => {
						if (!drag.active) return;
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
						drag.hover(rowHalf(e));
					},
					onDrop: drag === void 0 ? void 0 : (e) => {
						if (!drag.active) return;
						e.preventDefault();
						drag.drop(rowHalf(e));
					},`

const B4_ROWGATE_NEW = `					onDragOver: drag === void 0 ? void 0 : (e) => {
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
						drag.hover(rowHalf(e));
					},
					onDrop: drag === void 0 ? void 0 : (e) => {
						e.preventDefault();
						drag.drop(rowHalf(e));
					},`

const B4_UNGROUPED_FN_OLD = `				detachSession(owner.workspaceId, activeDrag.sessionId).catch((reason) => {
					console.warn("session detach rejected:", reason);
					try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};`

const B4_UNGROUPED_FN_NEW = `				detachSession(owner.workspaceId, activeDrag.sessionId).catch((reason) => {
					console.warn("session detach rejected:", reason);
					try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};
			const commitSessionCrossGroupDrag = (activeDrag, over) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				const targetKey = over.accountKey;
				if (targetKey === "") {
					const owner = workspaces.find((workspace) => workspace.sessionIds.includes(activeDrag.sessionId));
					if (owner === void 0) return;
					detachSession(owner.workspaceId, activeDrag.sessionId).catch((reason) => {
						console.warn("session detach rejected:", reason);
						try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
					});
					return;
				}
				const targetWorkspace = workspaces.find((workspace) => workspace.workspaceId === targetKey);
				const ids = targetWorkspace?.sessionIds ?? [];
				const targetIndex = ids.indexOf(over.id);
				const anchor = over.half === "before" ? over.id : (targetIndex >= 0 ? ids[targetIndex + 1] : void 0);
				insertSessionBefore(targetKey, activeDrag.sessionId, anchor).then(() => {
					setGroupExpanded(targetKey, true);
				}).catch((reason) => {
					console.warn("session move rejected:", reason);
					try { alert("移动会话失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};`

const B4_GROUPOVER_OLD = `								onDragOver: drag !== null || (workspaceDrag !== null && workspaceId !== void 0) ? (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									if (drag !== null) {
										setSessionDropMarker({ id: group.key, half: "after" });
									} else {
										hoverWorkspace(workspaceGroupHalf(e));
									}
								} : void 0,`

const B4_GROUPOVER_NEW = `								onDragOver: drag !== null || (workspaceDrag !== null && workspaceId !== void 0) ? (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									if (drag !== null) {
										setSessionDropMarker({ id: group.key, half: workspaceGroupHalf(e) });
									} else {
										hoverWorkspace(workspaceGroupHalf(e));
									}
								} : void 0,`

const B4_CLASS_OLD = `sessionDropMarker !== null && sessionDropMarker.id === group.key && (sessionDropMarker.half === "before" ? WorkspaceBrowser_module_css_default.workspaceDropBefore : WorkspaceBrowser_module_css_default.workspaceDropAfter)),`

const B4_CLASS_NEW = `sessionDropMarker !== null && sessionDropMarker.id === group.key && (sessionDropMarker.half === "before" ? Rows_module_css_default.dropBefore : Rows_module_css_default.dropAfter)),`

/**
 * blue-bar cross-group drag (v4): replace the group highlight with the same
 * blue insertion bar used for same-group reordering, extended across groups.
 *  - hovering any session row in ANY group while dragging shows the bar at
 *    the exact insertion point (before/after that row)
 *  - dropping inserts at that anchor via insertSessionBefore (workspace
 *    target, auto-attach) or detaches (ungrouped target)
 *  - header drops use the bar too (before/after the group header row)
 * Requires v1+v2+v3.
 */
export async function applyBlueBarDragPatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`blue-bar target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(BLUEBAR_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  if (!original.includes('const commitSessionCrossGroupDrag')) {
    // v3 must be present (it adds commitSessionToUngroupedDrag's detach block)
    if (!original.includes('detachSession(owner.workspaceId, activeDrag.sessionId)')) {
      throw new Error('blue-bar: ungrouped-detach (v3) is not applied; run --ungrouped-detach first')
    }
  }
  const pairs = [
    [B4_HOVER_OLD, B4_HOVER_NEW],
    [B4_MARKER_OLD, B4_MARKER_NEW],
    [B4_DROP_OLD, B4_DROP_NEW],
    [B4_END_OLD, B4_END_NEW],
    [B4_ROWGATE_OLD, B4_ROWGATE_NEW],
    [B4_UNGROUPED_FN_OLD, B4_UNGROUPED_FN_NEW],
    [B4_GROUPOVER_OLD, B4_GROUPOVER_NEW],
    [B4_CLASS_OLD, B4_CLASS_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('blue-bar: a text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-blue-bar.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  next = next.replace('const commitSessionCrossGroupDrag = (activeDrag, over) => {',
    `// dsh-toolbox blue-bar-drag\n\t\t\tconst commitSessionCrossGroupDrag = (activeDrag, over) => {`)
  writeFileSync(clientTarget, next)
  return [{ file: clientTarget, backup, changed: true }]
}

// --- ungrouped new-session anchor (v5): create + drop anchor under ungrouped

const NEWSESSION_MARKER = 'dsh-toolbox ungrouped-new-session'

const N5_CREATE_OLD = `										onCreate: () => {
											if (group.workspaceId !== void 0) {
												setGroupExpanded(group.key, true);
												startSession(group.workspaceId);
											}
										},`

const N5_CREATE_NEW = `										onCreate: () => {
											if (group.workspaceId !== void 0) {
												setGroupExpanded(group.key, true);
												startSession(group.workspaceId);
											} else {
												createUngroupedSession();
											}
										},`

const N5_ANCHOR_OLD = `										children: expandedSessionGroups.includes(group.key) ? t("sessions.collapse") : t("sessions.expand", { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })
									})
								]`

const N5_ANCHOR_NEW = `										children: expandedSessionGroups.includes(group.key) ? t("sessions.collapse") : t("sessions.expand", { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })
									}),
									group.key === "" && (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: clsx(Rows_module_css_default.sessionRow, WorkspaceBrowser_module_css_default.sessionOverflowButton),
										title: t("actions.newSession.aria", { name: "" }),
										onClick: () => {
											createUngroupedSession();
										},
										onDragOver: drag === null ? void 0 : (e) => {
											e.preventDefault();
											e.dataTransfer.dropEffect = "move";
											setSessionDropMarker({ id: group.key, half: "after" });
										},
										onDrop: drag === null ? void 0 : (e) => {
											e.preventDefault();
											if (drag !== null) commitSessionToUngroupedDrag(drag);
										},
										children: "＋ 新会话"
									})
								]`

const N5_ST_PROPS_OLD = `function SessionTree({ useSessions, startSession, open, forkSession,`

const N5_ST_PROPS_NEW = `function SessionTree({ useSessions, startSession, createUngroupedSession, open, forkSession,`

const N5_WB_PROPS_OLD = `function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession,`

const N5_WB_PROPS_NEW = `function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, createUngroupedSession, open, renameSession,`

const N5_RENDER_OLD = `							startSession,
							open,`

const N5_RENDER_NEW = `							startSession,
							createUngroupedSession,
							open,`

const N5_INJECT_OLD = `				detachSession: async (workspaceId, sessionId) => {
					const result = await ctx.get("connection").rpc.call("/api", "workspace.detachSession", { args: { workspaceId, sessionId } }, void 0);
					if (!result.ok) throw new Error('workspace detach failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

const N5_INJECT_NEW = `				detachSession: async (workspaceId, sessionId) => {
					const result = await ctx.get("connection").rpc.call("/api", "workspace.detachSession", { args: { workspaceId, sessionId } }, void 0);
					if (!result.ok) throw new Error('workspace detach failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},
				createUngroupedSession: async () => {
					const snapshot = ctx.workspaces.list.getSnapshot();
					const items = snapshot?.items ?? [];
					const current = ctx.sessions.list.getSnapshot().current;
					const workspace = items.find((item) => item.sessionIds.includes(current)) ?? items[0];
					const payload = workspace?.path === void 0 ? {} : { cwd: workspace.path };
					const result = await ctx.get("connection").rpc.call("/api", "session.create", { args: payload }, void 0);
					if (!result.ok) throw new Error('create ungrouped session failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					await ctx.sessions.open(result.value.sessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

/**
 * ungrouped new-session anchor (v5): a "＋ 新会话" row under the ungrouped
 * bucket. Clicking creates a session NOT attached to any workspace (cwd = the
 * current/first workspace path, so it can be attached later); the row is also
 * a drop anchor — dragging a workspace session onto it detaches it into
 * ungrouped, with the blue-bar feedback. Requires v1-v4.
 */
export async function applyUngroupedNewSessionPatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`ungrouped-new-session target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(NEWSESSION_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  const pairs = [
    [N5_CREATE_OLD, N5_CREATE_NEW],
    [N5_ANCHOR_OLD, N5_ANCHOR_NEW],
    [N5_ST_PROPS_OLD, N5_ST_PROPS_NEW],
    [N5_WB_PROPS_OLD, N5_WB_PROPS_NEW],
    [N5_RENDER_OLD, N5_RENDER_NEW],
    [N5_INJECT_OLD, N5_INJECT_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('ungrouped-new-session: a text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-ungrouped-new-session.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  next = next.replace('createUngroupedSession: async () => {',
    `// dsh-toolbox ungrouped-new-session\n\t\t\t\tcreateUngroupedSession: async () => {`)
  writeFileSync(clientTarget, next)
  return [{ file: clientTarget, backup, changed: true }]
}

// --- ungrouped anchor v6: a persistent empty session, not a button ----------

const ANCHOR6_MARKER = 'dsh-toolbox ungrouped-anchor'

const A6_REMOVE_BUTTON_OLD = `									}),
									group.key === "" && (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: clsx(Rows_module_css_default.sessionRow, WorkspaceBrowser_module_css_default.sessionOverflowButton),
										title: t("actions.newSession.aria", { name: "" }),
										onClick: () => {
											createUngroupedSession();
										},
										onDragOver: drag === null ? void 0 : (e) => {
											e.preventDefault();
											e.dataTransfer.dropEffect = "move";
											setSessionDropMarker({ id: group.key, half: "after" });
										},
										onDrop: drag === null ? void 0 : (e) => {
											e.preventDefault();
											if (drag !== null) commitSessionToUngroupedDrag(drag);
										},
										children: "＋ 新会话"
									})
								]`

const A6_REMOVE_BUTTON_NEW = `									})
								]`

const A6_CREATE_OLD = `				createUngroupedSession: async () => {
					const snapshot = ctx.workspaces.list.getSnapshot();
					const items = snapshot?.items ?? [];
					const current = ctx.sessions.list.getSnapshot().current;
					const workspace = items.find((item) => item.sessionIds.includes(current)) ?? items[0];
					const payload = workspace?.path === void 0 ? {} : { cwd: workspace.path };
					const result = await ctx.get("connection").rpc.call("/api", "session.create", { args: payload }, void 0);
					if (!result.ok) throw new Error('create ungrouped session failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					await ctx.sessions.open(result.value.sessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

const A6_CREATE_NEW = `				createUngroupedSession: async (options = {}) => {
					const snapshot = ctx.workspaces.list.getSnapshot();
					const items = snapshot?.items ?? [];
					const current = ctx.sessions.list.getSnapshot().current;
					const workspace = items.find((item) => item.sessionIds.includes(current)) ?? items[0];
					const payload = workspace?.path === void 0 ? {} : { cwd: workspace.path };
					const result = await ctx.get("connection").rpc.call("/api", "session.create", payload, void 0);
					if (!result.ok) throw new Error('create ungrouped session failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					if (options.open !== false) await ctx.sessions.open(result.value.sessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

const A6_EFFECT_OLD = `			const ungroupedSessionIds = (0, react.useMemo)(() => {
				const accounted = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
				return list.ids.filter((id) => list.byId[id] !== void 0 && !accounted.has(id));
			}, [list, workspaces]);`

const A6_EFFECT_NEW = `			const ungroupedSessionIds = (0, react.useMemo)(() => {
				const accounted = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
				return list.ids.filter((id) => list.byId[id] !== void 0 && !accounted.has(id));
			}, [list, workspaces]);
			// dsh-toolbox ungrouped-anchor: keep one EMPTY session under the
			// ungrouped bucket so it is never a dead zone — an openable row the
			// user can use anytime, and a real drop anchor for detaching
			// workspace sessions into ungrouped (the row carries the blue-bar +
			// detach path of a normal session row).
			const ungroupedAnchorRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (list.phase !== "ready") return;
				if (ungroupedSessionIds.length > 0) {
					ungroupedAnchorRef.current = false;
					return;
				}
				if (ungroupedAnchorRef.current) return;
				ungroupedAnchorRef.current = true;
				createUngroupedSession({ open: false }).catch((reason) => {
					ungroupedAnchorRef.current = false;
					console.warn("auto-create ungrouped session failed:", reason);
				});
			}, [ungroupedSessionIds.length, list.phase, createUngroupedSession]);`

/**
 * ungrouped anchor v6: replace the "+ 新会话" button with a persistent empty
 * session. Whenever the ungrouped bucket has no sessions, one empty session is
 * auto-created (without opening it): the user can open and use it anytime, and
 * it is a real session row, so dragging a workspace session onto it detaches
 * into ungrouped with the blue-bar feedback. Requires v5 (new-session-anchor).
 */
export async function applyUngroupedAnchorPatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`ungrouped-anchor target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(ANCHOR6_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  if (!original.includes('＋ 新会话') || !original.includes('createUngroupedSession: async')) {
    throw new Error('ungrouped-anchor: new-session-anchor (v5) is not applied; run --new-session-anchor first')
  }
  const pairs = [
    [A6_REMOVE_BUTTON_OLD, A6_REMOVE_BUTTON_NEW],
    [A6_CREATE_OLD, A6_CREATE_NEW],
    [A6_EFFECT_OLD, A6_EFFECT_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('ungrouped-anchor: a text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-ungrouped-anchor.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  next = next.replace('const ungroupedAnchorRef = (0, react.useRef)(false);',
    `// dsh-toolbox ungrouped-anchor\n\t\t\tconst ungroupedAnchorRef = (0, react.useRef)(false);`)
  writeFileSync(clientTarget, next)
  return [{ file: clientTarget, backup, changed: true }]
}

// --- ungrouped blank-visible (v7): blank sessions show under ungrouped ------

const BLANKVISIBLE_MARKER = 'dsh-toolbox ungrouped-blank-visible'

const B7_STRAY_OLD = `			const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && !accounted.has(s.id) && sessionVisible(s, list.current, archived));`

const B7_STRAY_NEW = `			// dsh-toolbox ungrouped-blank-visible: blank (empty) sessions are
			// normally hidden from the sidebar, which made the ungrouped bucket
			// look empty and unusable (no visible anchor). The ungrouped bucket
			// shows its blank sessions so there is always an openable row and a
			// drop anchor; workspace buckets keep the default hiding.
			const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && !accounted.has(s.id) && s.origin !== "subagent" && !archived.has(s.id));`

/**
 * ungrouped blank-visible (v7): relax the sidebar visibility rule for the
 * ungrouped bucket so blank (empty) sessions are shown there. sessionVisible
 * hides blank sessions by default, so both the pre-existing empty session and
 * any auto-created one were invisible and the bucket had no anchor. Blank
 * sessions remain hidden inside workspace buckets (default behavior).
 */
export async function applyUngroupedBlankVisiblePatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`ungrouped-blank-visible target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(BLANKVISIBLE_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  if (!original.includes(B7_STRAY_OLD)) {
    throw new Error('ungrouped-blank-visible: the stray filter no longer matches; aborting without touching the bundle')
  }
  const backup = `${clientTarget}.pre-ungrouped-blank-visible.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  writeFileSync(clientTarget, original.replace(B7_STRAY_OLD, B7_STRAY_NEW))
  return [{ file: clientTarget, backup, changed: true }]
}

// --- detach payload fix (v8): raw rpc.call takes the BARE payload -----------

const DETACHFIX_MARKER = 'dsh-toolbox detach-payload-fix'

const F8_DETACH_OLD = `				detachSession: async (workspaceId, sessionId) => {
					const result = await ctx.get("connection").rpc.call("/api", "workspace.detachSession", { args: { workspaceId, sessionId } }, void 0);`

const F8_DETACH_NEW = `				detachSession: async (workspaceId, sessionId) => {
					const result = await ctx.get("connection").rpc.call("/api", "workspace.detachSession", { workspaceId, sessionId }, void 0);`

const F8_CREATE_OLD = `					const result = await ctx.get("connection").rpc.call("/api", "session.create", { args: payload }, void 0);`

const F8_CREATE_NEW = `					const result = await ctx.get("connection").rpc.call("/api", "session.create", payload, void 0);`

/**
 * detach-payload-fix (v8): the browser connection's rpc.call forwards its
 * third argument verbatim as the message payload (callUnary-style), and the
 * host validates it against the method schema directly — the `{ args: ... }`
 * envelope is only a test-fixture convention. Without this fix the client
 * sent `{ args: { workspaceId, sessionId } }`, which fails validation with
 * "invalid payload for workspace.detachSession"; the same wrapper silently
 * dropped `cwd` on session.create.
 */
export async function applyDetachPayloadFix(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`detach-payload-fix target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(DETACHFIX_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  const pairs = [
    [F8_DETACH_OLD, F8_DETACH_NEW],
    [F8_CREATE_OLD, F8_CREATE_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('detach-payload-fix: a text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-detach-payload-fix.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  next = next.replace('detachSession: async (workspaceId, sessionId) => {',
    `// dsh-toolbox detach-payload-fix\n\t\t\t\tdetachSession: async (workspaceId, sessionId) => {`)
  writeFileSync(clientTarget, next)
  return [{ file: clientTarget, backup, changed: true }]
}

// --- clear cross-directory move error (v9) ---------------------------------

const MOVERR_MARKER = 'dsh-toolbox move-error-clarity'

const M9_HELPER_OLD = `			const commitSessionDrag = (activeDrag, over) => {`

const M9_HELPER_NEW = `			const workspaceMoveFailureAlert = (reason, sessionId, workspaceId) => {
				const message = (reason === null || reason === void 0 ? void 0 : reason.message) ?? String(reason);
				if (message.includes("not accounted")) {
					const summary = list.byId[sessionId];
					const workspace = workspaces.find((item) => item.workspaceId === workspaceId);
					console.warn("session move rejected:", reason);
					try {
						alert("无法移动会话：会话的工作目录是「" + (summary === void 0 ? "未知" : summary.cwd ?? "未知") + "」，目标工作区是「" + (workspace === void 0 ? workspaceId : workspace.path) + "」。Harness 将会话绑定到它的工作目录，跨目录移动会改变会话的工作目录（当前仅支持未运行的会话）。如需在该工作区使用，请在该工作区新建会话。");
					} catch {}
					return;
				}
				console.warn("session move rejected:", reason);
				try { alert("移动会话失败：" + message); } catch {}
			};
			const commitSessionDrag = (activeDrag, over) => {`

const M9_CATCH1_OLD = `				insertSessionBefore(workspaceId, activeDrag.sessionId, void 0).then(() => {
					setGroupExpanded(workspaceId, true);
				}).catch((reason) => {
					console.warn("session move rejected:", reason);
					try { alert("移动会话失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});`

const M9_CATCH1_NEW = `				insertSessionBefore(workspaceId, activeDrag.sessionId, void 0).then(() => {
					setGroupExpanded(workspaceId, true);
				}).catch((reason) => {
					workspaceMoveFailureAlert(reason, activeDrag.sessionId, workspaceId);
				});`

const M9_CATCH2_OLD = `				insertSessionBefore(targetKey, activeDrag.sessionId, anchor).then(() => {
					setGroupExpanded(targetKey, true);
				}).catch((reason) => {
					console.warn("session move rejected:", reason);
					try { alert("移动会话失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});`

const M9_CATCH2_NEW = `				insertSessionBefore(targetKey, activeDrag.sessionId, anchor).then(() => {
					setGroupExpanded(targetKey, true);
				}).catch((reason) => {
					workspaceMoveFailureAlert(reason, activeDrag.sessionId, targetKey);
				});`

/**
 * move-error-clarity (v9): explain WHY a cross-directory move fails. The host
 * rejects with the domain's cryptic "session is not accounted" when the
 * session's header cwd does not match the target workspace path (sessions are
 * bound to their working directory). The client now shows the session cwd and
 * the target workspace path and explains the model, instead of a bare
 * workspace-move-invalid message.
 */
export async function applyMoveErrorClarityPatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`move-error-clarity target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(MOVERR_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  const pairs = [
    [M9_HELPER_OLD, M9_HELPER_NEW],
    [M9_CATCH1_OLD, M9_CATCH1_NEW],
    [M9_CATCH2_OLD, M9_CATCH2_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('move-error-clarity: a text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-move-error-clarity.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  next = next.replace('const workspaceMoveFailureAlert = (reason, sessionId, workspaceId) => {',
    `// dsh-toolbox move-error-clarity\n\t\t\tconst workspaceMoveFailureAlert = (reason, sessionId, workspaceId) => {`)
  writeFileSync(clientTarget, next)
  return [{ file: clientTarget, backup, changed: true }]
}

// --- workspace bundle host patch (v10): unarchive + cross-directory move -----

const WSBUNDLE_MARKER = 'dsh-toolbox workspace-bundle'

const W10_WORKSPACE_OLD = `	archiveSession(sessionId) {
		return this.enqueueOperation(async () => {
			if (this.requireState().archivedSessionIds.includes(sessionId)) return;
			if (!await this.sessionKnown(sessionId)) throw new WorkspaceUnknownSessionError(sessionId);
			const state = this.requireState();
			await this.setState({
				...state,
				archivedSessionIds: [...state.archivedSessionIds, sessionId]
			});
		});
	}`

const W10_WORKSPACE_NEW = `	archiveSession(sessionId) {
		return this.enqueueOperation(async () => {
			if (this.requireState().archivedSessionIds.includes(sessionId)) return;
			if (!await this.sessionKnown(sessionId)) throw new WorkspaceUnknownSessionError(sessionId);
			const state = this.requireState();
			await this.setState({
				...state,
				archivedSessionIds: [...state.archivedSessionIds, sessionId]
			});
		});
	}
	/**
	* Remove a session id from the archived set (dsh-toolbox workspace bundle).
	* Resolves without writing when the id is not archived.
	*/
	unarchiveSession(sessionId) {
		return this.enqueueOperation(async () => {
			const state = this.requireState();
			if (!state.archivedSessionIds.includes(sessionId)) return;
			await this.setState({
				...state,
				archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)
			});
		});
	}`

const W10_CMD_OLD = `				return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] });
			}
		},
		host: {`

const W10_CMD_NEW = `				return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] });
			},
			async unarchiveSession(request) {
				const { sessionId } = request.payload;
				await ctx.workspaceRegistry.unarchiveSession(sessionId);
				return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] });
			},
			async moveSessionToWorkspace(request) {
				const { payload } = request;
				const { workspaceId, sessionId } = payload;
				const target = ctx.workspaceRegistry.get(WorkspaceId(workspaceId));
				if (target === void 0) return workspaceNotFound(request, workspaceId);
				const live = ctx.agents.get(sessionId);
				if (live !== void 0 && live.status === "running") {
					return err(request, {
						code: "session-running",
						message: \`session "\${sessionId}" is running; stop it before moving it to another workspace\`,
						details: { sessionId }
					});
				}
				const persistence = ctx.get("sessionPersistence");
				const root = persistence === void 0 ? void 0 : persistence.root;
				if (root === void 0 || typeof root !== "string") {
					return err(request, { code: "workspace-move-failed", message: "session persistence is unavailable", details: { sessionId } });
				}
				const projectKey = (cwd) => {
					let readable = "";
					let separatorRun = false;
					for (let i = 0; i < cwd.length; i++) {
						const code = cwd.charCodeAt(i);
						const ch = String.fromCharCode(code);
						if (ch === "/" || ch === "\\\\" || ch === ":") {
							if (!separatorRun) readable += "-";
							separatorRun = true;
						} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
							readable += ch;
							separatorRun = false;
						} else {
							readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
							separatorRun = false;
						}
					}
					const slug = readable.replace(/^-+/, "") || "root";
					return "--" + slug.slice(0, 251) + "--";
				};
				const encodeSegment = (raw) => {
					let out = "";
					for (let i = 0; i < raw.length; i++) {
						const code = raw.charCodeAt(i);
						const ch = String.fromCharCode(code);
						if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
						else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
					}
					return out;
				};
				const { readdir, mkdir, readFile, writeFile, rm } = await import("node:fs/promises");
				const { join } = await import("node:path");
				const { constants: zc, zstdCompress, zstdDecompressSync } = await import("node:zlib");
				const { promisify } = await import("node:util");
				const zstdCompressAsync = promisify(zstdCompress);
				const compressFrame = (input) => zstdCompressAsync(input, { params: { [zc.ZSTD_c_checksumFlag]: 1 } });
				const scanFrames = (buffer) => {
					const frames = [];
					let offset = 0;
					let tornStart;
					while (offset < buffer.length) {
						const start = offset;
						if (buffer.length - offset < 4) { tornStart = start; break; }
						if (buffer.readUInt32LE(offset) !== 4247762216) throw new Error("invalid frame magic");
						offset += 4;
						const descriptor = buffer.readUInt8(offset++);
						if ((descriptor & 24) !== 0) throw new Error("reserved frame-header bit");
						const contentSizeFlag = descriptor >>> 6;
						const singleSegment = (descriptor & 32) !== 0;
						const checksum = (descriptor & 4) !== 0;
						const dictionaryFlag = descriptor & 3;
						const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
						const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
						const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
						if (buffer.length - offset < remainingHeaderBytes) { tornStart = start; break; }
						offset += remainingHeaderBytes;
						for (;;) {
							if (buffer.length - offset < 3) { tornStart = start; break; }
							const blockHeader = buffer.readUIntLE(offset, 3);
							offset += 3;
							const lastBlock = (blockHeader & 1) !== 0;
							const blockType = blockHeader >>> 1 & 3;
							const blockSize = blockHeader >>> 3;
							if (blockType === 3) throw new Error("reserved block type");
							const payloadBytes = blockType === 1 ? 1 : blockSize;
							if (buffer.length - offset < payloadBytes) { tornStart = start; break; }
							offset += payloadBytes;
							if (lastBlock) break;
						}
						if (tornStart !== void 0) break;
						if (checksum) {
							if (buffer.length - offset < 4) { tornStart = start; break; }
							offset += 4;
						}
						frames.push({ start, end: offset });
					}
					return { frames, tornStart };
				};
				let foundPath;
				let header;
				try {
					const projects = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
					for (const project of projects) {
						const path = join(project, encodeSegment(sessionId), "session.jsonl.zstd");
						const bytes = await readFile(path).catch(() => void 0);
						if (bytes === void 0) continue;
						const { frames } = scanFrames(bytes);
						if (frames.length === 0) continue;
						const first = zstdDecompressSync(bytes.subarray(frames[0].start, frames[0].end));
						const parsed = JSON.parse(first.subarray(0, -1).toString("utf8"));
						if (typeof parsed?.id !== "string" || parsed.id !== sessionId) continue;
						foundPath = path;
						header = parsed;
						break;
					}
				} catch (error) {
					return err(request, { code: "workspace-move-failed", message: "cannot read session artifact: " + String(error), details: { sessionId } });
				}
				if (foundPath === void 0 || header === void 0) {
					return err(request, { code: "workspace-move-failed", message: "no stored artifact for session \\"" + sessionId + "\\"", details: { sessionId } });
				}
				if (header.cwd === target.path) {
					return err(request, { code: "workspace-move-invalid", message: "session \\"" + sessionId + "\\" already lives in workspace \\"" + target.path + "\\"", details: { sessionId } });
				}
				try {
					for (const workspace of ctx.workspaceRegistry.list()) {
						if (workspace.sessionIds.includes(sessionId)) await workspace.detachSession(sessionId);
					}
					const bytes = await readFile(foundPath);
					const { frames } = scanFrames(bytes);
					const first = zstdDecompressSync(bytes.subarray(frames[0].start, frames[0].end));
					const rest = bytes.subarray(frames[0].end);
					const newFirst = await compressFrame(Buffer.from(JSON.stringify({ ...header, cwd: target.path }) + "\\n"));
					const newDir = join(root, projectKey(target.path), encodeSegment(sessionId));
					await mkdir(newDir, { recursive: true, mode: 0o700 });
					await writeFile(join(newDir, "session.jsonl.zstd"), Buffer.concat([newFirst, rest]));
					await writeFile(join(newDir, "session.jsonl.zstd.pre-move-" + Date.now() + ".bak"), bytes);
					const check = await readFile(join(newDir, "session.jsonl.zstd"));
					const { frames: checkFrames } = scanFrames(check);
					const checkFirst = zstdDecompressSync(check.subarray(checkFrames[0].start, checkFrames[0].end));
					const checkHeader = JSON.parse(checkFirst.subarray(0, -1).toString("utf8"));
					if (checkHeader.cwd !== target.path) throw new Error("verification failed after relocation");
					await rm(dirname(foundPath), { recursive: true, force: true });
					await target.attachSession(sessionId);
				} catch (error) {
					return err(request, { code: "workspace-move-failed", message: "cannot move session \\"" + sessionId + "\\": " + String(error), details: { sessionId } });
				}
				return ok(request, { workspace: workspaceView(target) });
			}
		},
		host: {`

const W10_SCHEMA_OLD = `/** workspace.archiveSession response value: the full updated archive set. */
const workspaceArchiveSessionValueSchema = z$1.object({ archivedSessionIds: z$1.array(sessionIdSchema) });`

const W10_SCHEMA_NEW = `/** workspace.archiveSession response value: the full updated archive set. */
const workspaceArchiveSessionValueSchema = z$1.object({ archivedSessionIds: z$1.array(sessionIdSchema) });
/** workspace.unarchiveSession request payload (dsh-toolbox workspace bundle). */
const workspaceUnarchiveSessionRequestSchema = z$1.object({ sessionId: sessionIdSchema });
/** workspace.unarchiveSession response value (dsh-toolbox workspace bundle). */
const workspaceUnarchiveSessionValueSchema = z$1.object({ archivedSessionIds: z$1.array(sessionIdSchema) });
/** workspace.moveSessionToWorkspace request payload (dsh-toolbox workspace bundle). */
const workspaceMoveSessionToWorkspaceRequestSchema = z$1.object({
	workspaceId: workspaceIdSchema,
	sessionId: sessionIdSchema
});
/** workspace.moveSessionToWorkspace response value (dsh-toolbox workspace bundle). */
const workspaceMoveSessionToWorkspaceValueSchema = z$1.object({ workspace: workspaceViewSchema });`

const W10_REGISTRY_OLD = `	"workspace.archiveSession": {
		schema: workspaceArchiveSessionRequestSchema,
		invoke: (api, r) => api.workspace.archiveSession(r)
	},`

const W10_REGISTRY_NEW = `	"workspace.archiveSession": {
		schema: workspaceArchiveSessionRequestSchema,
		invoke: (api, r) => api.workspace.archiveSession(r)
	},
	"workspace.unarchiveSession": {
		schema: workspaceUnarchiveSessionRequestSchema,
		invoke: (api, r) => api.workspace.unarchiveSession(r)
	},
	"workspace.moveSessionToWorkspace": {
		schema: workspaceMoveSessionToWorkspaceRequestSchema,
		invoke: (api, r) => api.workspace.moveSessionToWorkspace(r)
	},`

const W10_VALUEMAP_OLD = `	"workspace.archiveSession": workspaceArchiveSessionValueSchema,`

const W10_VALUEMAP_NEW = `	"workspace.archiveSession": workspaceArchiveSessionValueSchema,
	"workspace.unarchiveSession": workspaceUnarchiveSessionValueSchema,
	"workspace.moveSessionToWorkspace": workspaceMoveSessionToWorkspaceValueSchema,`

/**
 * workspace-bundle (v10, host side): the unified workspace-management RPCs.
 *  - workspace.unarchiveSession — remove a session from the archived set
 *  - workspace.moveSessionToWorkspace — move a session to ANOTHER directory's
 *    workspace: refuses running sessions, relocates the log to the target
 *    project dir, rewrites the header cwd (recompressing the header frame,
 *    events untouched), keeps a .pre-move backup, verifies before removing
 *    the old artifact, and updates workspace accounting (detach + attach).
 */
export async function applyWorkspaceBundleHostPatch(dshInstall) {
  const wsTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-workspace', 'lib', 'index.js')
  const apiTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
  for (const target of [wsTarget, apiTarget]) {
    if (!existsSync(target)) throw new Error(`workspace-bundle target not found: ${target}`)
  }
  const results = []
  const wsOriginal = readFileSync(wsTarget, 'utf8')
  if (!wsOriginal.includes('unarchiveSession(sessionId)')) {
    if (!wsOriginal.includes(W10_WORKSPACE_OLD)) throw new Error('workspace-bundle: dsh-workspace build changed; aborting')
    const backup = `${wsTarget}.pre-workspace-bundle.bak`
    if (!existsSync(backup)) copyFileSync(wsTarget, backup)
    writeFileSync(wsTarget, wsOriginal.replace(W10_WORKSPACE_OLD, W10_WORKSPACE_NEW))
    results.push({ file: wsTarget, backup, changed: true })
  } else {
    results.push({ file: wsTarget, alreadyPatched: true })
  }

  const apiOriginal = readFileSync(apiTarget, 'utf8')
  if (!apiOriginal.includes(WSBUNDLE_MARKER)) {
    const pairs = [
      [W10_CMD_OLD, W10_CMD_NEW],
      [W10_SCHEMA_OLD, W10_SCHEMA_NEW],
      [W10_REGISTRY_OLD, W10_REGISTRY_NEW],
      [W10_VALUEMAP_OLD, W10_VALUEMAP_NEW],
    ]
    for (const [oldText] of pairs) {
      if (!apiOriginal.includes(oldText)) throw new Error('workspace-bundle: host apiproxy build changed; aborting')
    }
    const backup = `${apiTarget}.pre-workspace-bundle.bak`
    if (!existsSync(backup)) copyFileSync(apiTarget, backup)
    let next = apiOriginal
    for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
    next = next.replace('async unarchiveSession(request) {', `// dsh-toolbox workspace-bundle\n\t\t\tasync unarchiveSession(request) {`)
    writeFileSync(apiTarget, next)
    results.push({ file: apiTarget, backup, changed: true })
  } else {
    results.push({ file: apiTarget, alreadyPatched: true })
  }
  return results
}

// --- workspace bundle client patch (v11): archived folder + unarchive drag ---

const WSBUNDLE_CLIENT_MARKER = 'dsh-toolbox workspace-bundle-client'

const W11_GROUP_OLD = `			const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && !accounted.has(s.id) && s.origin !== "subagent" && !archived.has(s.id));
			// dsh-toolbox ungrouped-detach: the ungrouped bucket is always
			// rendered so it can serve as a drop target for moving sessions out
			// of a workspace (detaching). An empty bucket just shows the header.
			groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));`

const W11_GROUP_NEW = `			const archivedMembers = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && archived.has(s.id) && s.origin !== "subagent");
			// dsh-toolbox workspace-bundle-client: an always-visible archived
			// folder, so archived sessions can be found and dragged out
			// (dragging one onto a workspace/ungrouped unarchives it).
			groups.push(buildGroup("archived", void 0, void 0, void 0, "归档", archivedMembers, "account"));
			const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && !accounted.has(s.id) && s.origin !== "subagent" && !archived.has(s.id));
			// dsh-toolbox ungrouped-detach: the ungrouped bucket is always
			// rendered so it can serve as a drop target for moving sessions out
			// of a workspace (detaching). An empty bucket just shows the header.
			groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));`

const W11_CREATE_OLD = `										onCreate: () => {
											if (group.workspaceId !== void 0) {
												setGroupExpanded(group.key, true);
												startSession(group.workspaceId);
											} else {
												createUngroupedSession();
											}
										},`

const W11_CREATE_NEW = `										onCreate: () => {
											if (group.workspaceId !== void 0) {
												setGroupExpanded(group.key, true);
												startSession(group.workspaceId);
											} else if (group.key === "") {
												createUngroupedSession();
											}
										},`

const W11_DROP_OLD = `									if (drag !== null) {
										if (workspaceId !== void 0) commitSessionToWorkspaceDrag(drag, workspaceId);
										else commitSessionToUngroupedDrag(drag);
									} else {`

const W11_DROP_NEW = `									if (drag !== null) {
										if (workspaceId !== void 0) commitSessionToWorkspaceDrag(drag, workspaceId);
										else if (group.key === "") commitSessionToUngroupedDrag(drag);
										else if (group.key === "archived") commitSessionToArchiveDrag(drag);
									} else {`

const W11_ARCHIVE_FN_OLD = `					console.warn("session detach rejected:", reason);
					try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};
			// dsh-toolbox blue-bar-drag`

const W11_ARCHIVE_FN_NEW = `					console.warn("session detach rejected:", reason);
					try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};
			const commitSessionToArchiveDrag = (activeDrag) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				onSessionArchive(activeDrag.sessionId).catch((reason) => {
					console.warn("session archive rejected:", reason);
					try { alert("归档失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};
			// dsh-toolbox blue-bar-drag`

const W11_WSDRAG_OLD = `			const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				insertSessionBefore(workspaceId, activeDrag.sessionId, void 0).then(() => {
					setGroupExpanded(workspaceId, true);
				}).catch((reason) => {
					workspaceMoveFailureAlert(reason, activeDrag.sessionId, workspaceId);
				});
			};`

const W11_WSDRAG_NEW = `			const commitSessionToWorkspaceDrag = (activeDrag, workspaceId) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				const sessionId = activeDrag.sessionId;
				const unarchived = archivedSessionIds.includes(sessionId) ? unarchiveSession(sessionId) : Promise.resolve();
				unarchived.then(() => insertSessionBefore(workspaceId, sessionId, void 0).then(() => {
					setGroupExpanded(workspaceId, true);
				}, (reason) => {
					const message = (reason === null || reason === void 0 ? void 0 : reason.message) ?? String(reason);
					if (message.includes("not accounted")) {
						const workspace = workspaces.find((item) => item.workspaceId === workspaceId);
						try {
							if (confirm("该会话的工作目录与目标工作区「" + (workspace === void 0 ? workspaceId : workspace.path) + "」不同。移动会改变会话的工作目录（仅支持未运行的会话）。是否继续？")) {
								return moveSessionToWorkspace(workspaceId, sessionId).then(() => {
									setGroupExpanded(workspaceId, true);
								});
							}
						} catch {}
					}
					throw reason;
				})).catch((reason) => {
					workspaceMoveFailureAlert(reason, sessionId, workspaceId);
				});
			};`

const W11_UNGROUPED_OLD = `			const commitSessionToUngroupedDrag = (activeDrag) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				const owner = workspaces.find((workspace) => workspace.sessionIds.includes(activeDrag.sessionId));
				if (owner === void 0) return;
				detachSession(owner.workspaceId, activeDrag.sessionId).catch((reason) => {
					console.warn("session detach rejected:", reason);
					try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};`

const W11_UNGROUPED_NEW = `			const commitSessionToUngroupedDrag = (activeDrag) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				const sessionId = activeDrag.sessionId;
				const unarchived = archivedSessionIds.includes(sessionId) ? unarchiveSession(sessionId) : Promise.resolve();
				unarchived.then(() => {
					const owner = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
					if (owner === void 0) return;
					return detachSession(owner.workspaceId, sessionId);
				}).catch((reason) => {
					console.warn("session detach rejected:", reason);
					try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
				});
			};`

const W11_CROSS_OLD = `			const commitSessionCrossGroupDrag = (activeDrag, over) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				const targetKey = over.accountKey;
				if (targetKey === "") {
					const owner = workspaces.find((workspace) => workspace.sessionIds.includes(activeDrag.sessionId));
					if (owner === void 0) return;
					detachSession(owner.workspaceId, activeDrag.sessionId).catch((reason) => {
						console.warn("session detach rejected:", reason);
						try { alert("移出工作区失败：" + ((reason === null || reason === void 0 ? void 0 : reason.message) ?? reason)); } catch {}
					});
					return;
				}
				const targetWorkspace = workspaces.find((workspace) => workspace.workspaceId === targetKey);
				const ids = targetWorkspace?.sessionIds ?? [];
				const targetIndex = ids.indexOf(over.id);
				const anchor = over.half === "before" ? over.id : (targetIndex >= 0 ? ids[targetIndex + 1] : void 0);
				insertSessionBefore(targetKey, activeDrag.sessionId, anchor).then(() => {
					setGroupExpanded(targetKey, true);
				}).catch((reason) => {
					workspaceMoveFailureAlert(reason, activeDrag.sessionId, targetKey);
				});
			};`

const W11_CROSS_NEW = `			const commitSessionCrossGroupDrag = (activeDrag, over) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				setSessionDropMarker(null);
				const sessionId = activeDrag.sessionId;
				const targetKey = over.accountKey;
				const unarchived = archivedSessionIds.includes(sessionId) ? unarchiveSession(sessionId) : Promise.resolve();
				unarchived.then(() => {
					if (targetKey === "") {
						const owner = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
						if (owner === void 0) return;
						return detachSession(owner.workspaceId, sessionId);
					}
					if (targetKey === "archived") return;
					const targetWorkspace = workspaces.find((workspace) => workspace.workspaceId === targetKey);
					const ids = targetWorkspace?.sessionIds ?? [];
					const targetIndex = ids.indexOf(over.id);
					const anchor = over.half === "before" ? over.id : (targetIndex >= 0 ? ids[targetIndex + 1] : void 0);
					return insertSessionBefore(targetKey, sessionId, anchor).then(() => {
						setGroupExpanded(targetKey, true);
					}, (reason) => {
						const message = (reason === null || reason === void 0 ? void 0 : reason.message) ?? String(reason);
						if (message.includes("not accounted")) {
							try {
								if (confirm("该会话的工作目录与目标工作区「" + (targetWorkspace === void 0 ? targetKey : targetWorkspace.path) + "」不同。移动会改变会话的工作目录（仅支持未运行的会话）。是否继续？")) {
									return moveSessionToWorkspace(targetKey, sessionId).then(() => {
										setGroupExpanded(targetKey, true);
									});
								}
							} catch {}
						}
						throw reason;
					});
				}).catch((reason) => {
					workspaceMoveFailureAlert(reason, sessionId, targetKey);
				});
			};`

const W11_ST_PROPS_OLD = `function SessionTree({ useSessions, startSession, createUngroupedSession, open, forkSession,`

const W11_ST_PROPS_NEW = `function SessionTree({ useSessions, startSession, createUngroupedSession, unarchiveSession, moveSessionToWorkspace, open, forkSession,`

const W11_WB_PROPS_OLD = `function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, createUngroupedSession, open, renameSession,`

const W11_WB_PROPS_NEW = `function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, createUngroupedSession, unarchiveSession, moveSessionToWorkspace, open, renameSession,`

const W11_RENDER_OLD = `							startSession,
							createUngroupedSession,
							open,`

const W11_RENDER_NEW = `							startSession,
							createUngroupedSession,
							unarchiveSession,
							moveSessionToWorkspace,
							open,`

const W11_INJECT_OLD = `				createUngroupedSession: async (options = {}) => {
					const snapshot = ctx.workspaces.list.getSnapshot();
					const items = snapshot?.items ?? [];
					const current = ctx.sessions.list.getSnapshot().current;
					const workspace = items.find((item) => item.sessionIds.includes(current)) ?? items[0];
					const payload = workspace?.path === void 0 ? {} : { cwd: workspace.path };
					const result = await ctx.get("connection").rpc.call("/api", "session.create", payload, void 0);
					if (!result.ok) throw new Error('create ungrouped session failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					if (options.open !== false) await ctx.sessions.open(result.value.sessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

const W11_INJECT_NEW = `				createUngroupedSession: async (options = {}) => {
					const snapshot = ctx.workspaces.list.getSnapshot();
					const items = snapshot?.items ?? [];
					const current = ctx.sessions.list.getSnapshot().current;
					const workspace = items.find((item) => item.sessionIds.includes(current)) ?? items[0];
					const payload = workspace?.path === void 0 ? {} : { cwd: workspace.path };
					const result = await ctx.get("connection").rpc.call("/api", "session.create", payload, void 0);
					if (!result.ok) throw new Error('create ungrouped session failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					if (options.open !== false) await ctx.sessions.open(result.value.sessionId);
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},
				unarchiveSession: async (sessionId) => {
					const result = await ctx.get("connection").rpc.call("/api", "workspace.unarchiveSession", { sessionId }, void 0);
					if (!result.ok) throw new Error('unarchive failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},
				moveSessionToWorkspace: async (workspaceId, sessionId) => {
					const result = await ctx.get("connection").rpc.call("/api", "workspace.moveSessionToWorkspace", { workspaceId, sessionId }, void 0);
					if (!result.ok) throw new Error('cross-directory move failed: ' + (result.error?.code ?? '') + ': ' + (result.error?.message ?? ''));
					await (ctx.workspaces.refresh === void 0 ? void 0 : ctx.workspaces.refresh());
				},`

/**
 * workspace-bundle-client (v11): the archived folder + drag-based unarchive.
 *  - an always-visible "归档" folder in the sidebar lists archived sessions
 *  - dragging an archived session onto a workspace/ungrouped unarchives it
 *    first, then attaches/moves (cross-directory moves ask for confirmation
 *    and call workspace.moveSessionToWorkspace)
 *  - dropping a session onto the archived folder archives it
 */
export async function applyWorkspaceBundleClientPatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`workspace-bundle-client target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(WSBUNDLE_CLIENT_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  const pairs = [
    [W11_GROUP_OLD, W11_GROUP_NEW],
    [W11_CREATE_OLD, W11_CREATE_NEW],
    [W11_DROP_OLD, W11_DROP_NEW],
    [W11_ARCHIVE_FN_OLD, W11_ARCHIVE_FN_NEW],
    [W11_WSDRAG_OLD, W11_WSDRAG_NEW],
    [W11_UNGROUPED_OLD, W11_UNGROUPED_NEW],
    [W11_CROSS_OLD, W11_CROSS_NEW],
    [W11_ST_PROPS_OLD, W11_ST_PROPS_NEW],
    [W11_WB_PROPS_OLD, W11_WB_PROPS_NEW],
    [W11_RENDER_OLD, W11_RENDER_NEW],
    [W11_INJECT_OLD, W11_INJECT_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('workspace-bundle-client: a text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-workspace-bundle-client.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  next = next.replace('const commitSessionToArchiveDrag = (activeDrag) => {',
    `// dsh-toolbox workspace-bundle-client\n\t\t\tconst commitSessionToArchiveDrag = (activeDrag) => {`)
  writeFileSync(clientTarget, next)
  return [{ file: clientTarget, backup, changed: true }]
}

// --- archived folder label fix (v12): it showed as "未分组" ----------------

const ARCHLABEL_MARKER = 'dsh-toolbox archived-label'

const W12_LABEL_OLD = `			const label = row.workspaceId === void 0 ? t("group.ungrouped") : row.label;`

const W12_LABEL_NEW = `			const label = row.workspaceId === void 0 ? (row.key === "archived" ? "归档" : t("group.ungrouped")) : row.label;`

/**
 * archived-label (v12): ProjectRowItem rendered every group without a
 * workspaceId as "未分组" — including the archived folder added by the
 * workspace-bundle patch, producing two "未分组" sections. The archived
 * folder now shows "归档".
 */
export async function applyArchivedLabelPatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`archived-label target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(ARCHLABEL_MARKER) || original.includes(W12_LABEL_NEW)) {
    return [{ file: clientTarget, alreadyPatched: true }]
  }
  if (!original.includes(W12_LABEL_OLD)) {
    throw new Error('archived-label: the label line no longer matches; aborting without touching the bundle')
  }
  const backup = `${clientTarget}.pre-archived-label.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  writeFileSync(clientTarget, original.replace(W12_LABEL_OLD, W12_LABEL_NEW))
  return [{ file: clientTarget, backup, changed: true }]
}

// --- moveSessionToWorkspace persistence fix (v13) ---------------------------

const MOVEPERSIST_MARKER = 'dsh-toolbox move-persistence-fix'

const W13_OLD = `				const persistence = ctx.sessionPersistence;`

const W13_NEW = `				const persistence = ctx.get("sessionPersistence");`

/**
 * move-persistence-fix (v13): the moveSessionToWorkspace command accessed
 * ctx.sessionPersistence by property, which cordis blocks ("cannot get
 * property without inject") because that service is not in the command's
 * inject list. Session-controller uses ctx.get("sessionPersistence"); do the
 * same so cross-directory moves actually run.
 */
export async function applyMovePersistenceFix(dshInstall) {
  const apiTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
  if (!existsSync(apiTarget)) throw new Error(`move-persistence-fix target not found: ${apiTarget}`)
  const original = readFileSync(apiTarget, 'utf8')
  if (original.includes(MOVEPERSIST_MARKER) || original.includes(W13_NEW)) {
    return [{ file: apiTarget, alreadyPatched: true }]
  }
  if (!original.includes(W13_OLD)) {
    throw new Error('move-persistence-fix: the persistence access line no longer matches; aborting')
  }
  const backup = `${apiTarget}.pre-move-persistence-fix.bak`
  if (!existsSync(backup)) copyFileSync(apiTarget, backup)
  writeFileSync(apiTarget, original.replace(W13_OLD, W13_NEW))
  return [{ file: apiTarget, backup, changed: true }]
}

// --- empty-group drop placeholder (v14): a real landing row in empty groups

const EMPTYDROP_MARKER = 'dsh-toolbox empty-drop-row'

const W14_CLASS_OLD = `								className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter, sessionDropMarker !== null && sessionDropMarker.id === group.key && (sessionDropMarker.half === "before" ? Rows_module_css_default.dropBefore : Rows_module_css_default.dropAfter)),`

const W14_CLASS_NEW = `								className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter),`

const W14_ROW_OLD = `										children: expandedSessionGroups.includes(group.key) ? t("sessions.collapse") : t("sessions.expand", { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })
									})
								]`

const W14_ROW_NEW = `										children: expandedSessionGroups.includes(group.key) ? t("sessions.collapse") : t("sessions.expand", { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })
									}),
									group.sessions.length === 0 && (0, react_jsx_runtime.jsx)("div", {
										className: clsx(Rows_module_css_default.sessionRow, sessionDropMarker !== null && sessionDropMarker.id === group.key ? (sessionDropMarker.half === "before" ? Rows_module_css_default.dropBefore : Rows_module_css_default.dropAfter) : void 0),
										onDragOver: drag === null ? void 0 : (e) => {
											e.preventDefault();
											e.dataTransfer.dropEffect = "move";
											setSessionDropMarker({ id: group.key, half: "after" });
										},
										onDrop: drag === null ? void 0 : (e) => {
											e.preventDefault();
											if (drag !== null) {
												if (workspaceId !== void 0) commitSessionToWorkspaceDrag(drag, workspaceId);
												else if (group.key === "") commitSessionToUngroupedDrag(drag);
												else if (group.key === "archived") commitSessionToArchiveDrag(drag);
											}
										},
										children: (0, react_jsx_runtime.jsx)("span", {
											className: Rows_module_css_default.title,
											children: "（空）拖放到此处"
										})
									})
								]`

/**
 * empty-drop-row (v14): an empty workspace/group had no session rows, so a
 * drag over it showed no blue-bar landing point. Empty groups now render a
 * real session-row placeholder ("（空）拖放到此处") that is itself the drop
 * target: it lights up with the blue insertion bar on hover and drops into
 * the group's normal handler (workspace: attach/move; ungrouped: detach;
 * archived: archive). The group-section-level highlight is removed in favor
 * of the row-level bar.
 */
export async function applyEmptyDropRowPatch(dshInstall) {
  const clientTarget = join(dshInstall, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  if (!existsSync(clientTarget)) throw new Error(`empty-drop-row target not found: ${clientTarget}`)
  const original = readFileSync(clientTarget, 'utf8')
  if (original.includes(EMPTYDROP_MARKER)) return [{ file: clientTarget, alreadyPatched: true }]
  const pairs = [
    [W14_CLASS_OLD, W14_CLASS_NEW],
    [W14_ROW_OLD, W14_ROW_NEW],
  ]
  for (const [oldText] of pairs) {
    if (!original.includes(oldText)) {
      throw new Error('empty-drop-row: a text block no longer matches; aborting without touching the bundle')
    }
  }
  const backup = `${clientTarget}.pre-empty-drop-row.bak`
  if (!existsSync(backup)) copyFileSync(clientTarget, backup)
  let next = original
  for (const [oldText, newText] of pairs) next = next.replace(oldText, newText)
  next = next.replace('group.sessions.length === 0 && (0, react_jsx_runtime.jsx)("div", {',
    `// dsh-toolbox empty-drop-row\n\t\t\t\t\t\t\t\t\tgroup.sessions.length === 0 && (0, react_jsx_runtime.jsx)("div", {`)
  writeFileSync(clientTarget, next)
  return [{ file: clientTarget, backup, changed: true }]
}
