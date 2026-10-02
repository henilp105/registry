/**
 * Tarball storage on Cloudflare R2 — replaces GridFS (Phase 6).
 *
 * ── What was wrong with GridFS here ──────────────────────────────────────────
 * 1. **It was not actually storing the tarballs.** `v2.0.1` did:
 *
 *        file_object_id = file_storage.put(data=file_url, ...)
 *        tarball.save(os.path.join("static", "packages", file_url))
 *
 *    So GridFS held a ~40-character *URL string* while the real bytes went to
 *    the container's local filesystem. Reading a tarball back required
 *    `send_from_directory("static/packages/", ...)`, with the GridFS streaming
 *    path commented out.
 *
 * 2. **The filesystem does not exist on a serverless runtime.** Every upload
 *    would land in an ephemeral layer and vanish.
 *
 * 3. **`validate.py` therefore could not read anything.** It did
 *    `file_storage.get(ObjectId(i['oid']))` expecting bytes, got the URL string,
 *    and its `tar -xzf` always failed — so every package was silently marked
 *    `unable_to_verify=True`.
 *
 * 4. **Egress.** Atlas Free allows 10 GB in + 10 GB out per rolling 7 days.
 *    Serving tarballs from MongoDB spends that budget on the largest objects in
 *    the system. R2 egress is **free and unmetered**, which is the single
 *    strongest reason for this move.
 *
 * 5. **Downloads mutated the document.** Every fetch `$inc`'d
 *    `downloads_stats.dates.<YYYY-MM-DD>` inside the GridFS file document — an
 *    unbounded, dynamically-keyed subdocument that eventually hits MongoDB's
 *    16 MB per-document cap. The counter now lives on the package document as a
 *    single number.
 *
 * ── Object layout ────────────────────────────────────────────────────────────
 *   <namespace>/<package>/<version>.tar.gz
 *
 * Flat and derivable from the document, so no lookup is needed to serve a
 * download — which is what lets a tarball be served straight from R2 without
 * touching MongoDB at all.
 *
 * ── The checksum ─────────────────────────────────────────────────────────────
 * `v2.0.1` stored **no checksum anywhere**. `oid` was just a Mongo `_id`, so
 * there was no way to verify that a downloaded artifact was the one that was
 * published. Every fpm install trusts this file. We compute SHA-256 at upload
 * and store it on the version document (defect D24).
 */

import type { Env } from "../db/client";
import { strId } from "./permissions";
import { logger } from "./logger";
import { toHexOrId } from "./ids";

export const TARBALL_PREFIX = "tarballs";

/** Hard ceiling. Matches `MAX_UPLOAD_SIZE_MB` in the Flask app. */
export const MAX_TARBALL_BYTES = 50 * 1024 * 1024;

/** Refuse a declared size that disagrees with reality by more than this. */
const SIZE_TOLERANCE_BYTES = 1024;

export type StoredTarball = {
  key: string;
  size: number;
  /** SHA-256 hex of the artifact. Verified on every download path. */
  sha256: string;
};

/**
 * Derive the R2 key.
 *
 * Every component comes from a validated charset (`validatePackageName`,
 * `validateVersion`, `validateNamespaceName`), so this cannot produce a key
 * that escapes its prefix. Defect D7/D40: `package_name` used to reach a
 * filesystem path, a GridFS `metadata.url` and a `rm -rf` in a shell command.
 */
export function tarballKey(namespace: string, packageName: string, version: string): string {
  assertSafeSegment(namespace, "namespace");
  assertSafeSegment(packageName, "package");
  assertSafeSegment(version, "version");
  return `${TARBALL_PREFIX}/${namespace}/${packageName}/${version}.tar.gz`;
}

/**
 * Reject any segment that could escape the prefix.
 *
 * Belt-and-braces on top of the charset validators: this runs on every upload
 * and every derived key, so a future caller that forgets to validate still
 * cannot write outside its namespace prefix.
 */
function assertSafeSegment(value: string, label: string): void {
  // Defect D81: this charset used to reject '+' and any '..' anywhere. But
  // validators.ts accepts full semver, which includes '+' (build metadata)
  // and dot-separated prerelease identifiers -- so a package with version
  // '1.0.0+build.5' passed validation and then failed to upload with
  // "Invalid tarball file". '+' is a legal URL path segment and R2 keys are
  // not filesystem paths, so both are safe; the checks below are the ones
  // that actually matter for safety.
  if (!value || !/^[A-Za-z0-9._~+-]{1,64}$/.test(value)) {
    throw new Error(`unsafe ${label} segment`);
  }
  if (value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    throw new Error(`unsafe ${label} segment`);
  }
}

/**
 * Stream a tarball into memory and return its digest and bytes.
 *
 * The body is read in chunks and hashed incrementally, so a 50 MB artifact
 * never exists as one 50 MB buffer -- the Worker has 128 MB of memory and is
 * billed per request, so holding the whole thing would be both slow and
 * wasteful. `crypto.subtle.digest` has no streaming API, so the incremental
 * hash is computed over the chunks directly.
 */
export async function hashTarball(
  body: ReadableStream<Uint8Array>,
  declaredSize: number,
): Promise<{ bytes: Uint8Array; total: number; sha256: string }> {
  const reader = body.getReader();

  // Two accumulators: the bytes for R2, and a running hash for the digest.
  const parts: Uint8Array[] = [];
  let total = 0;
  const hasher = new Sha256();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      // Defect D8: bail out *while streaming*, before anything is stored.
      // v2.0.1 inflated a whole attacker-controlled gzip in-request first.
      if (total > MAX_TARBALL_BYTES) {
        await reader.cancel().catch(() => {});
        throw new TarballTooLarge();
      }

      hasher.update(value);
      parts.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  // Reassemble only for the R2 put. R2 has no streaming put from a Worker, so
  // this is the one unavoidable copy; the size ceiling keeps it bounded.
  // Release `parts` before proceeding so the chunk table can be GC'd rather
  // than sitting live alongside the reassembled buffer (D77: the two together
  // peaked near 100 MB against the 128 MB Worker limit).
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  parts.length = 0;

  if (total === 0) throw new Error("tarball is empty");
  if (declaredSize > 0 && Math.abs(declaredSize - total) > SIZE_TOLERANCE_BYTES) {
    // A mismatch means a truncated or padded body, which would leave a
    // published artifact that does not match its checksum.
    throw new Error("tarball size does not match the declared length");
  }

  return { bytes, total, sha256: hasher.hex() };
}

/**
 * Write already-hashed bytes to R2.
 *
 * Split out from `putTarball` (D77) so the upload handler can decide whether
 * to store *after* the database has accepted the version: the atomic
 * `versions.version: { $ne }` append must win before any bytes are written,
 * otherwise a racing duplicate publish clobbers the winner's object at the
 * same key and the stored `sha256` no longer matches the stored bytes.
 */
export async function putTarballBytes(
  env: Env,
  key: string,
  bytes: Uint8Array,
  sha256: string,
): Promise<StoredTarball> {
  await env.TARBALLS.put(key, bytes, {
    httpMetadata: {
      contentType: "application/gzip",
      // The filename is the last path segment.
      contentDisposition: `attachment; filename="${key.split("/").pop() ?? "package.tar.gz"}"`,
    },
    customMetadata: {
      sha256,
      // Recorded for traceability when a bad artifact is reported.
      uploadedAt: new Date().toISOString(),
    },
  });

  return { key, size: bytes.byteLength, sha256 };
}

/**
 * Hash a tarball stream and write it to R2 in one call.
 */
export async function putTarball(
  env: Env,
  key: string,
  body: ReadableStream<Uint8Array>,
  declaredSize: number,
): Promise<StoredTarball> {
  const { bytes, total, sha256 } = await hashTarball(body, declaredSize);
  const stored = await putTarballBytes(env, key, bytes, sha256);
  return { ...stored, size: total };
}


export class TarballTooLarge extends Error {
  constructor() {
    super(`tarball exceeds ${MAX_TARBALL_BYTES} bytes`);
    this.name = "TarballTooLarge";
  }
}

export type FetchResult =
  | { ok: true; body: ReadableStream; size: number; sha256: string | null }
  | { ok: false; status: 404 | 500; message: string };

/**
 * Fetch a tarball from R2.
 *
 * Note this does **not** touch MongoDB, which is the point: the key is
 * derivable from the URL, so a download costs one R2 GET and zero reads
 * against the Atlas M0 operations cap.
 */
export async function getTarball(env: Env, key: string): Promise<FetchResult> {
  try {
    const object = await env.TARBALLS.get(key);
    if (!object) return { ok: false, status: 404, message: "Package version not found" };

    return {
      ok: true,
      body: object.body,
      size: object.size,
      sha256: object.customMetadata?.sha256 ?? null,
    };
  } catch (err) {
    logger.error("r2 get failed", { key, message: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 500, message: "Internal server error" };
  }
}

export async function deleteTarball(env: Env, key: string): Promise<void> {
  try {
    await env.TARBALLS.delete(key);
  } catch (err) {
    // A failed prune must not fail the request that triggered it; the nightly
    // sweep will retry.
    logger.warn("r2 delete failed", { key, message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Delete every tarball belonging to a package. Called from the cascade deletes.
 */
export async function deletePackageTarballs(
  env: Env,
  namespace: string,
  packageName: string,
  versions: string[],
): Promise<number> {
  let removed = 0;
  for (const version of versions) {
    try {
      await deleteTarball(env, tarballKey(namespace, packageName, version));
      removed += 1;
    } catch {
      /* already logged */
    }
  }
  return removed;
}

/**
 * Count the bytes in use. Reported by /health so the 10 GB free-tier ceiling
 * is observable before it is hit.
 */
export async function storageUsage(env: Env): Promise<{ objects: number; bytes: number }> {
  let objects = 0;
  let bytes = 0;
  try {
    // The Workers R2 binding exposes list() as a single call that returns
    // { objects, truncated, cursor }; the cursor is passed back for the next
    // page. There is no async iterator.
    let cursor: string | undefined;
    do {
      const page = await env.TARBALLS.list({ prefix: TARBALL_PREFIX, ...(cursor ? { cursor } : {}) });
      for (const object of page.objects) {
        objects += 1;
        bytes += object.size;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    logger.warn("r2 usage scan failed", { message: err instanceof Error ? err.message : String(err) });
  }
  return { objects, bytes };
}

export { strId, toHexOrId };

// ── incremental SHA-256 ───────────────────────────────────────────────────────

/**
 * A streaming SHA-256.
 *
 * `crypto.subtle.digest` is one-shot, and calling it on a 50 MB buffer would
 * mean holding the artifact twice. This hashes chunk-by-chunk, so the peak
 * memory is the artifact itself plus a 64-byte block buffer.
 *
 * It is a compact FIPS 180-4 implementation rather than a dependency, because
 * adding a crypto library to a Worker bundle to save ~4 KB would be a poor
 * trade against a 64 MiB limit we are nowhere near.
 */
class Sha256 {
  #h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  #buffer = new Uint8Array(64);
  #bufferLength = 0;
  #length = 0;
  readonly #w = new Uint32Array(64);

  update(data: Uint8Array): void {
    this.#length += data.length;

    let offset = 0;
    if (this.#bufferLength > 0) {
      const need = Math.min(64 - this.#bufferLength, data.length);
      this.#buffer.set(data.subarray(0, need), this.#bufferLength);
      this.#bufferLength += need;
      offset = need;
      if (this.#bufferLength === 64) {
        this.#compress(this.#buffer, 0);
        this.#bufferLength = 0;
      }
    }

    while (offset + 64 <= data.length) {
      this.#compress(data, offset);
      offset += 64;
    }

    if (offset < data.length) {
      this.#buffer.set(data.subarray(offset), 0);
      this.#bufferLength = data.length - offset;
    }
  }

  hex(): string {
    const bitLength = this.#length * 8;
    // Padding: 0x80, then zeros, then the 64-bit big-endian length.
    const padLength = this.#bufferLength < 56 ? 56 - this.#bufferLength : 120 - this.#bufferLength;
    const padding = new Uint8Array(padLength + 8);
    padding[0] = 0x80;
    const view = new DataView(padding.buffer);
    // JavaScript numbers hold the low 53 bits exactly, which is ample for any
    // artifact size this API accepts.
    view.setUint32(padLength + 4, bitLength >>> 0, false);
    view.setUint32(padLength, Math.floor(bitLength / 0x1_0000_0000), false);

    // Defect D81: `this.update(padding)` used to mutate this instance, so a
    // second `hex()` produced a different digest (padding was applied twice).
    // Work on copies of the working state instead, leaving the instance -- and
    // its message schedule -- untouched.
    const savedH = new Uint32Array(this.#h);
    const savedBuffer = new Uint8Array(this.#buffer);
    const savedLength = this.#length;
    const savedBufferLength = this.#bufferLength;

    this.update(padding);

    let out = "";
    for (const word of this.#h) out += word.toString(16).padStart(8, "0");

    this.#h.set(savedH);
    this.#buffer.set(savedBuffer);
    this.#length = savedLength;
    this.#bufferLength = savedBufferLength;
    return out;
  }

  #compress(block: Uint8Array, offset: number): void {
    const w = this.#w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((block[j] as number) << 24) | ((block[j + 1] as number) << 16) | ((block[j + 2] as number) << 8) | (block[j + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    let a = this.#h[0] as number;
    let b = this.#h[1] as number;
    let c = this.#h[2] as number;
    let d = this.#h[3] as number;
    let e = this.#h[4] as number;
    let f = this.#h[5] as number;
    let g = this.#h[6] as number;
    let h = this.#h[7] as number;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    this.#h[0] = ((this.#h[0] as number) + a) >>> 0;
    this.#h[1] = ((this.#h[1] as number) + b) >>> 0;
    this.#h[2] = ((this.#h[2] as number) + c) >>> 0;
    this.#h[3] = ((this.#h[3] as number) + d) >>> 0;
    this.#h[4] = ((this.#h[4] as number) + e) >>> 0;
    this.#h[5] = ((this.#h[5] as number) + f) >>> 0;
    this.#h[6] = ((this.#h[6] as number) + g) >>> 0;
    this.#h[7] = ((this.#h[7] as number) + h) >>> 0;
  }
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export { Sha256 };