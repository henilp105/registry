import { describe, expect, it } from "vitest";
import {
  compareVersionsDescending,
  latestVersion,
  parseVersion,
  validateEmail,
  validateLicense,
  validateNamespaceName,
  validatePackageName,
  validatePassword,
  validateUsername,
  validateVersion,
  MIN_PASSWORD_LENGTH,
} from "../src/lib/validators";

describe("validateUsername", () => {
  it.each(["abc", "user_1", "a-b-c", "A".repeat(30)])("accepts %s", (v) => {
    expect(validateUsername(v).ok).toBe(true);
  });

  it.each(["ab", "a".repeat(31), "has space", "has.dot", "has@at", "", "üñí"])("rejects %s", (v) => {
    expect(validateUsername(v).ok).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const v of [undefined, null, 42, {}, []]) {
      expect(validateUsername(v).ok).toBe(false);
    }
  });
});

describe("validateEmail", () => {
  it.each(["a@b.co", "first.last+tag@sub.domain.org"])("accepts %s", (v) => {
    expect(validateEmail(v).ok).toBe(true);
  });

  it.each(["no-at-sign", "a@b", "@b.co", "a@.co", `${"a".repeat(250)}@b.co`, ""])(
    "rejects %s",
    (v) => {
      expect(validateEmail(v).ok).toBe(false);
    },
  );
});

describe("validatePassword", () => {
  it(`enforces the documented minimum of ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it("does not impose composition rules the deployed app never enforced", () => {
    // v2.0.1 checks length only, while docs/authentication.md claims
    // upper+lower+digit+special. We match the code, not the doc, so we do not
    // reject users the live app already accepted.
    expect(validatePassword("aaaaaaaaaaaa").ok).toBe(true);
  });

  it("bounds length so PBKDF2 cost cannot be inflated", () => {
    expect(validatePassword("a".repeat(513)).ok).toBe(false);
  });
});

describe("package and namespace names (defect D7)", () => {
  it("accepts ordinary names", () => {
    for (const v of ["json-fortran", "hdf5", "my_pkg", "A1"]) {
      expect(validatePackageName(v).ok).toBe(true);
      expect(validateNamespaceName(v).ok).toBe(true);
    }
  });

  it("rejects shell metacharacters that reached `subprocess.run(shell=True)`", () => {
    // validate.py interpolated packagename into mkdir/tar/fpm/rm -rf with
    // shell=True. Every one of these is a command-injection payload.
    for (const v of [
      "evil;rm -rf /",
      "evil$(whoami)",
      "evil`id`",
      "evil|cat",
      "evil&&ls",
      "evil\nrm",
    ]) {
      expect(validatePackageName(v).ok).toBe(false);
    }
  });

  it("rejects path traversal sequences", () => {
    for (const v of ["../etc", "..", "a/b", "a\\b", "..."]) {
      expect(validatePackageName(v).ok).toBe(false);
    }
  });
});

describe("validateVersion", () => {
  it.each(["1.0.0", "0.9.0", "0.10.0", "1.0.0-rc.1", "1.0.0+build.5"])("accepts %s", (v) => {
    expect(validateVersion(v).ok).toBe(true);
  });

  it("bans 0.0.0, matching packages.py:264", () => {
    expect(validateVersion("0.0.0").ok).toBe(false);
  });

  it.each(["1.0", "v1.0.0", "1", "somerandomstring", "1.0.0.0"])("rejects %s", (v) => {
    expect(validateVersion(v).ok).toBe(false);
  });

  it("rejects versions ending in .tar.gz (would collide with the R2 key suffix)", () => {
    expect(validateVersion("1.0.0-rc.tar.gz").ok).toBe(false);
  });
});

describe("validateLicense", () => {
  it.each(["MIT", "Apache-2.0", "GPL-3.0-or-later", "BSD-3-Clause", "0BSD", "MPL-2.0"])(
    "accepts the SPDX id %s",
    (v) => {
      expect(validateLicense(v).ok).toBe(true);
    },
  );

  it.each(["ABC", "NOT-A-LICENSE", "", "   ", "MIT-FAKE-9.9"])(
    "rejects %s — it is charset-valid but not an SPDX identifier",
    (v) => {
      // This is the exact case the Flask suite pins with
      // test_package_invalid_license, which posts "ABC" and asserts 400.
      // A /^[A-Za-z0-9.+-]+$/ regex would have wrongly accepted it.
      expect(validateLicense(v).ok).toBe(false);
    },
  );

  it("accepts an 'or later' suffix", () => {
    expect(validateLicense("GPL-2.0+").ok).toBe(true);
    expect(validateLicense("LGPL-2.1+").ok).toBe(true);
  });

  it("accepts compound expressions, which license_expression supports", () => {
    expect(validateLicense("MIT OR Apache-2.0").ok).toBe(true);
    expect(validateLicense("MIT AND BSD-3-Clause").ok).toBe(true);
    expect(validateLicense("(MIT OR BSD-3-Clause) AND Apache-2.0").ok).toBe(true);
  });

  it("accepts an exception, and rejects an unknown one", () => {
    expect(validateLicense("GPL-2.0-only WITH Classpath-exception-2.0").ok).toBe(true);
    expect(validateLicense("GPL-2.0-only WITH Not-A-Real-Exception").ok).toBe(false);
  });

  it("rejects malformed expressions", () => {
    for (const v of [
      "MIT OR",
      "OR MIT",
      "(MIT",
      "MIT)",
      "()",
      "MIT WITH",
      "MIT OR OR Apache-2.0",
      "MIT AND WITH Classpath-exception-2.0",
      "a".repeat(600),
    ]) {
      expect(validateLicense(v).ok).toBe(false);
    }
  });

  it("quotes the offending value in the error, matching the legacy message", () => {
    const result = validateLicense("ABC");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ABC");
      expect(result.message).toContain("SPDX");
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(validateLicense("  MIT  ").ok).toBe(true);
  });
});

describe("semver ordering (defect D9)", () => {
  it("orders numerically, not lexicographically", () => {
    // This is the bug. A string sort gives "0.10.0" < "0.9.0", so
    // `versions[-1]` — reported to clients as latest_version_data — would be
    // the wrong version.
    const versions = ["0.9.0", "0.10.0", "0.1.0"];
    expect([...versions].sort()).toEqual(["0.1.0", "0.10.0", "0.9.0"]); // the bug
    expect([...versions].sort(compareVersionsDescending)).toEqual([
      "0.10.0",
      "0.9.0",
      "0.1.0",
    ]);
  });

  it("picks the true latest version", () => {
    expect(latestVersion(["0.9.0", "0.10.0", "0.1.0"])).toBe("0.10.0");
    expect(latestVersion(["1.0.0", "2.1.0", "1.9.9"])).toBe("2.1.0");
    expect(latestVersion(["0.0.1", "0.0.2"])).toBe("0.0.2");
  });

  it("sorts a pre-release before its release, per semver section 11", () => {
    expect(latestVersion(["1.0.0-rc.1", "1.0.0"])).toBe("1.0.0");
    expect(latestVersion(["1.0.0", "1.0.0-rc.1"])).toBe("1.0.0");
  });

  it("does not mutate its input", () => {
    const input = ["0.9.0", "0.10.0"];
    latestVersion(input);
    expect(input).toEqual(["0.9.0", "0.10.0"]);
  });

  it("sorts unparseable versions last instead of throwing", () => {
    const sorted = ["garbage", "1.0.0", "also-bad"].sort(compareVersionsDescending);
    expect(sorted[0]).toBe("1.0.0");
    expect(sorted).toHaveLength(3);
  });

  it("returns undefined for an empty list", () => {
    expect(latestVersion([])).toBeUndefined();
  });

  it("parses major/minor/patch and pre-release", () => {
    expect(parseVersion("1.2.3-rc.4")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      pre: "rc.4",
    });
    expect(parseVersion("not-a-version")).toBeNull();
  });
});