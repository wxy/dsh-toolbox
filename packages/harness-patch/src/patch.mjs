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
