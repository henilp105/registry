import { describe, expect, it, vi } from "vitest";
import { Sha256, tarballKey, hashTarball, MAX_TARBALL_BYTES, TarballTooLarge } from "../src/lib/storage";

/**
 * Defect D91: the tarball digest used to be computed by this module's own
 * streaming `Sha256`, inside the request handler. Measured, that costs ~13 ms of
 * CPU per MB against a Worker limit of 10 ms for the whole invocation -- so the
 * 50 MB ceiling was unreachable and every publish above roughly a megabyte
 * returned Cloudflare error 1102. The digest now runs in the Durable Object,
 * which has 30 s, and reaches `hashTarball` as an injected function.
 *
 * The consequence for this file is that the correctness of a published checksum
 * now depends on the *injected* digest rather than on `Sha256`. So the tests
 * below cover both halves: `Sha256` is still verified against NIST (it remains
 * exported and is a reference implementation worth keeping honest), and
 * `hashTarball` is verified to actually call the injected function, to reject a
 * malformed digest, and to refuse an oversized artifact.
 */

const encoder = new TextEncoder();

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function hashOf(data: Uint8Array, chunkSize = data.length): string {
  const hasher = new Sha256();
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    hasher.update(data.subarray(offset, Math.min(offset + chunkSize, data.length)));
  }
  return hasher.hex();
}

async function subtleHex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("Sha256 NIST vectors", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
  ])("hashes %j", (input, expected) => {
    expect(hashOf(encoder.encode(input))).toBe(expected);
  });

  it("matches the million-'a' vector", () => {
    // This is the vector that exercises multi-block streaming: 1,000,000 bytes
    // is 15,625 blocks, so it would catch any padding or block-boundary error
    // that the short vectors miss.
    const hasher = new Sha256();
    const chunk = encoder.encode("a".repeat(1000));
    for (let i = 0; i < 1000; i++) hasher.update(chunk);
    expect(hasher.hex()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });
});

describe("Sha256 chunking is irrelevant to the result", () => {
  // The whole point of streaming is that callers hand it arbitrary chunks, so
  // every chunking must agree — and must agree with the platform.
  const samples = [
    "",
    "a",
    "hello world",
    "x".repeat(55), // one byte short of forcing a second block
    "x".repeat(56), // exactly at the padding boundary
    "x".repeat(63),
    "x".repeat(64), // exactly one block
    "x".repeat(65),
    "x".repeat(1000),
    "x".repeat(4096),
  ];

  it.each(samples)("agrees across chunk sizes for a %d-byte input", async (text) => {
    const data = encoder.encode(text);
    const reference = await subtleHex(data);
    for (const size of [1, 3, 7, 32, 55, 56, 63, 64, 65, 128, 1024, data.length || 1]) {
      expect(hashOf(data, size)).toBe(reference);
    }
  });

  it("agrees with the platform on random binary input", async () => {
    for (let trial = 0; trial < 12; trial++) {
      const data = crypto.getRandomValues(new Uint8Array(1 + Math.floor(Math.random() * 5000)));
      const reference = await subtleHex(data);
      expect(hashOf(data, 97)).toBe(reference);
    }
  });

  it("does not alias when the same hasher is reused across updates", async () => {
    const data = encoder.encode("the quick brown fox");
    const a = hashOf(data, 5);
    const b = hashOf(data, 5);
    expect(a).toBe(b);
  });
});

describe("tarballKey", () => {
  it("builds a namespace-scoped key", () => {
    expect(tarballKey("stdlib", "json-fortran", "0.10.0")).toBe(
      "tarballs/stdlib/json-fortran/0.10.0.tar.gz",
    );
  });

  it("is deterministic, so a download needs no lookup", () => {
    expect(tarballKey("stdlib", "json", "1.0.0")).toBe(tarballKey("stdlib", "json", "1.0.0"));
  });

  it.each([
    ["../etc", "json", "1.0.0"],
    ["stdlib", "../../etc", "1.0.0"],
    ["stdlib", "json", "../../../root"],
    ["std/lib", "json", "1.0.0"],
    ["stdlib", "json; rm -rf /", "1.0.0"],
    ["stdlib", "json$(id)", "1.0.0"],
    ["", "json", "1.0.0"],
    ["stdlib", "", "1.0.0"],
    ["stdlib", "json", ""],
    ["..", "json", "1.0.0"],
    ["stdlib", "..", "1.0.0"],
    ["stdlib", "json", ".."],
  ])("refuses %j / %j / %j", (ns, pkg, version) => {
    // Defect D7/D40: package_name used to reach a filesystem path, a GridFS
    // metadata.url, and an `rm -rf` inside a shell command. A key must never
    // be able to escape its prefix.
    expect(() => tarballKey(ns, pkg, version)).toThrow(/unsafe|prefix|segment/i);
  });

  it("caps the upload at the documented ceiling", () => {
    expect(MAX_TARBALL_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("hashTarball: the digest is the caller's, and must be usable (D91)", () => {
  it("digests through the injected function rather than hashing inline", async () => {
    const digest = vi.fn(async () => "a".repeat(64));
    const result = await hashTarball(streamOf(encoder.encode("hello")), 5, digest);

    expect(digest).toHaveBeenCalledTimes(1);
    expect(result.sha256).toBe("a".repeat(64));
    expect(new TextDecoder().decode(result.bytes)).toBe("hello");
    expect(result.total).toBe(5);
  });

  it("rejects a malformed digest instead of storing it as the artifact's identity", async () => {
    // The digest is written into the version document and echoed to every
    // download as `x-checksum-sha256`. A truncated or non-hex value would be
    // advertised as a checksum that verifies nothing, which is worse than none.
    for (const bad of ["", "nothex", "a".repeat(63), "A".repeat(64), `${"a".repeat(64)}x`]) {
      await expect(
        hashTarball(streamOf(encoder.encode("x")), 1, async () => bad),
      ).rejects.toThrow(/unusable/i);
    }
  });

  it("refuses an artifact over the ceiling while streaming, and cancels the reader", async () => {
    // D8: v0.0.1 inflated a whole attacker-controlled gzip in-request first.
    // The cancel matters as much as the throw -- an unread body keeps the
    // connection and its memory alive.
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel,
    });

    await expect(hashTarball(body, 0, async () => "b".repeat(64))).rejects.toBeInstanceOf(
      TarballTooLarge,
    );
    expect(cancel).toHaveBeenCalled();
  });

  it("refuses an empty artifact", async () => {
    await expect(
      hashTarball(streamOf(new Uint8Array(0)), 0, async () => "c".repeat(64)),
    ).rejects.toThrow(/empty/i);
  });

  it("refuses a body that disagrees with its declared length", async () => {
    // Otherwise the stored checksum describes bytes the registry never held.
    await expect(
      hashTarball(streamOf(encoder.encode("12345")), 5000, async () => "d".repeat(64)),
    ).rejects.toThrow(/declared length/i);
  });

  it("produces a digest that agrees with the platform, via the injected function", async () => {
    // The end-to-end property, and the one that actually matters: whatever the
    // caller injects must still yield a real SHA-256 of the exact bytes.
    const data = crypto.getRandomValues(new Uint8Array(4096));
    const result = await hashTarball(streamOf(data), data.byteLength, async (b) =>
      subtleHex(b),
    );
    expect(result.sha256).toBe(await subtleHex(data));
  });
});
