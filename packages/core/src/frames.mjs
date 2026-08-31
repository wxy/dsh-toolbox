/**
 * Zstandard frame utilities over node:zlib, mirroring the contract the harness
 * reader enforces: every frame is checksummed, and the FIRST frame of a
 * session log must contain exactly the header line.
 */
import { promisify } from 'node:util'
import { constants, zstdCompress, zstdDecompressSync } from 'node:zlib'

export const ZSTD_MAGIC = 4247762216 // 0xFD2FB528 LE

/** Scan a buffer into complete zstd frames plus an optional torn tail start. */
export function scanFrames(buffer) {
  const frames = []
  let offset = 0
  let tornStart
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) { tornStart = start; break }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid Zstandard frame magic at byte ${offset}`)
    }
    offset += 4
    const descriptor = buffer.readUInt8(offset++)
    if ((descriptor & 24) !== 0) throw new Error('reserved Zstandard frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) { tornStart = start; break }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) { tornStart = start; break }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = blockHeader >>> 1 & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('reserved Zstandard block type')
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) { tornStart = start; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (tornStart !== undefined) break
    if (checksum) {
      if (buffer.length - offset < 4) { tornStart = start; break }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, tornStart }
}

/** Decompress exactly one complete frame (validates its checksum). */
export function decompressFrame(buffer) {
  return zstdDecompressSync(buffer)
}

/** Compress one checksummed frame, matching the harness writer (async). */
export async function compressFrame(input) {
  return promisify(zstdCompress)(input, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
}

/** Concatenated plaintext of all complete frames (torn tail omitted). */
export function framesToPlaintext(buffer) {
  const { frames } = scanFrames(buffer)
  return Buffer.concat(frames.map(frame => decompressFrame(buffer.subarray(frame.start, frame.end))))
}

/** The harness reader's layout rule for the first frame. */
export function assertHeaderFrame(plaintext) {
  if (plaintext.length === 0 || plaintext.indexOf(0x0a) !== plaintext.length - 1) {
    throw new Error('corrupt Zstandard session log: first frame is not exactly one header line')
  }
}
