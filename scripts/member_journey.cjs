#!/usr/bin/env node
/**
 * Drives namespace membership management through the browser.
 *
 *   node scripts/member_journey.cjs [APP_BASE] [API_BASE]
 *
 * Requires `playwright` and `mongodb`:
 *   NODE_PATH=<repo>/worker/node_modules node scripts/member_journey.cjs
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Defect D68 made these four dialogs reachable for the first time. Until it was
 * fixed, `/users/{u}` reported `isNamespaceAdmin: false` for everyone, so the
 * dashboard rendered a namespace card with **no buttons at all** — no Add Admin,
 * no Remove Admin, no Add Maintainer, no Generate Token. Nobody could open these
 * dialogs, which means nothing had ever run them.
 *
 * That makes this the last untested surface on the registry, and the most
 * dangerous one: it is the privilege-escalation boundary. The properties that
 * matter are
 *
 *   1. an owner can grant and revoke namespace admin and maintainer;
 *   2. the grant is *visible to the grantee* — which is D68's fix observed from
 *      the other side, through a real request rather than a unit test;
 *   3. a user with a lesser role cannot promote themselves;
 *   4. a non-member cannot join a namespace they were not invited to;
 *   5. revocation actually revokes.
 *
 * (3) and (4) are the ones that matter most, and the ones a happy-path test would
 * never reach.
 */

const { signIn } = require("./_signed_in.cjs");
const { mongoUri, mongoDbName } = require("./_env.cjs");

const APP = process.argv[2] ?? "http://127.0.0.1:5173";
const API = process.argv[3] ?? "http://127.0.0.1:8787";
const { MongoClient } = require("mongodb");

const URI = mongoUri("member_journey.cjs");
const DB = mongoDbName();

let passed = 0;
const failures = [];
const ok = (n, d = "") => {
  passed++;
  console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
};
const bad = (n, d) => {
  failures.push({ n, d });
  console.log(`  FAIL  ${n} — ${d}`);
};
const check = (n, c, d = "") => (c ? ok(n, d) : bad(n, d || "assertion failed"));

async function until(fn, { tries = 40, gap = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, gap));
  }
  return null;
}

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB);
  const nsCol = db.collection("namespaces");
  const userCol = db.collection("users");

  const pageErrors = [];
  const calls = [];

  const NS = `mj${Date.now().toString(36)}`;
  const DESC = "membership journey namespace, long enough";

  // ── owner ──────────────────────────────────────────────────────────────────
  const owner = await signIn();
  owner.page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));
  owner.page.on("response", (r) => {
    if (r.url().includes(":8787")) calls.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")}`);
  });

  console.log(`\nnamespace membership through the UI — ${NS}\n`);

  // ── a second account, the grantee ──────────────────────────────────────────
  console.log("[setup]");
  const grantee = await signIn();
  const outsider = await signIn();

  // Every page, not just the owner's: `page.evaluate` cannot close over Node scope,
  // and setting it on one context left the grantee's probe sending an empty
  // `namespace`, so the revocation check was reading a 400 *validation* error as an
  // authorisation refusal -- a vacuous pass on the most security-relevant assertion
  // in the file.
  for (const p of [owner.page, grantee.page, outsider.page]) {
    await p.addInitScript((n) => { window.__NSNAME__ = n; }, NS);
  }

  await owner.page.goto(`${APP}/namespace/create`, { waitUntil: "networkidle" });
  for (const [n, v] of [["namespace", NS], ["namespace_description", DESC]]) {
    const el = owner.page.locator(`[name='${n}']`).first();
    await el.click();
    await el.fill(v);
  }
  await owner.page.locator("form button[type=submit]").first().click();
  const nsDoc = await until(() => nsCol.findOne({ namespace: NS }));
  check("the namespace exists", !!nsDoc, NS);
  if (!nsDoc) throw new Error("cannot continue without a namespace");

  const ownerId = String(nsDoc.author);
  check(
    "the creator is author, admin and maintainer",
    String(nsDoc.admins?.[0]) === ownerId && String(nsDoc.maintainers?.[0]) === ownerId,
    `admins=${JSON.stringify(nsDoc.admins)} maintainers=${JSON.stringify(nsDoc.maintainers)}`,
  );

  // ── the grant ──────────────────────────────────────────────────────────────
  console.log("\n[owner grants namespace admin through the dialog]");
  await owner.page.goto(`${APP}/manage/projects`, { waitUntil: "networkidle" });
  await until(() => owner.page.locator(`text=${NS}`).count());
  await owner.page.waitForTimeout(700);

  // Every membership dialog is opened here rather than one of four.
  //
  // The first version of this harness drove Add Admin through its dialog and then
  // called the other three endpoints directly, on the reasoning that they hit the
  // same API. That is exactly the assumption that hid D68: the API was right and
  // the dialogs were unreachable. Four dialogs, four sets of field mapping, four
  // reducers -- they have to each be opened.
  const openDialog = async (label) => {
    const card = owner.page.locator(".card", { hasText: NS }).first();
    const btn = card.locator("button", { hasText: label }).first();
    if ((await btn.count()) === 0) return null;
    await btn.click();
    await owner.page.waitForTimeout(600);
    return owner.page.locator(".modal-content").last();
  };

  /** Fills a membership dialog's single username field and submits it. */
  const submitMember = async (dialog, username) => {
    const input = dialog.locator("input").first();
    await input.click();
    await input.fill(username);
    calls.length = 0;
    await dialog.locator("button", { hasText: /^(Add|Remove|Grant|Submit)/i }).first().click();
    await owner.page.waitForTimeout(1600);
    return dialog.innerText();
  };

  const closeDialog = async (dialog) => {
    const cancel = dialog.locator("button", { hasText: /^(Cancel|Close)$/i }).first();
    if ((await cancel.count()) > 0) {
      await cancel.click();
      await owner.page.waitForTimeout(500);
    }
  };

  const dialog = await openDialog("Add Admin");
  check("the Add Admin button is offered (D68)", !!dialog);
  if (!dialog) throw new Error("no Add Admin button — is D68 regressed?");

  // An empty username must be refused before any request.
  calls.length = 0;
  await dialog.locator("button", { hasText: /^(Add|Grant|Submit)/i }).first().click();
  await owner.page.waitForTimeout(800);
  let t = await dialog.innerText();
  check("an empty username is refused with a message", /required|enter|invalid/i.test(t),
    (t.match(/[A-Z][^.]*(?:required|enter|invalid)[^.]*\./i) ?? [""])[0]);
  check("no request was sent for an invalid username",
    !calls.some((c) => c.includes("namespace/admin")), JSON.stringify(calls));

  // The real grant.
  const input = dialog.locator("input").first();
  await input.click();
  await input.fill(grantee.USER);
  calls.length = 0;
  await dialog.locator("button", { hasText: /^(Add|Grant|Submit)/i }).first().click();
  await owner.page.waitForTimeout(1600);
  t = await dialog.innerText();
  check("the owner is told the grant succeeded",
    /success|added|granted/i.test(t) && !/error|failed|already/i.test(t),
    (t.match(/[A-Z][^.]*(?:success|added|granted)[^.]*\./i) ?? [""])[0] || t.slice(0, 110));

  // Declared out here on purpose: an earlier version computed this inside the
  // polling closure, so the assertions 60 lines below referenced a binding that no
  // longer existed -- a ReferenceError that would have surfaced as "harness crashed"
  // rather than as the check it was meant to be.
  const granteeDoc = await userCol.findOne({ username: grantee.USER });
  const outsiderDoc = await userCol.findOne({ username: outsider.USER });
  const afterGrant = await until(async () => {
    const d = await nsCol.findOne({ namespace: NS });
    return d && String(d.admins ?? []).includes(String(granteeDoc._id)) ? d : null;
  });
  check("the grantee is really in the namespace's admins", !!afterGrant,
    afterGrant ? `admins=${JSON.stringify(afterGrant.admins)}` : "not in admins");

  // ── the grant is visible to the grantee (D68 from the other side) ───────────
  console.log("\n[the grantee sees their new rights]");
  const seen = await grantee.page.evaluate(async ([api, u]) => {
    const raw = window.localStorage.getItem("persist:root");
    const auth = JSON.parse(JSON.parse(raw).auth);
    const r = await fetch(`${api}/users/${u}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    return { status: r.status, body: await r.json() };
  }, [API, grantee.USER]);

  const mine = (seen.body.namespaces ?? []).find((n) => n.name === NS);
  check("the namespace appears on the grantee's profile", !!mine, seen.body.namespaces?.map((n) => n.name).join(","));
  // This is the assertion that would have caught D68 from the outside.
  check("the grantee is told they are a namespace admin", mine?.isNamespaceAdmin === true,
    `isNamespaceAdmin=${mine?.isNamespaceAdmin}`);

  // ── escalation attempts ────────────────────────────────────────────────────
  console.log("\n[a lesser role cannot promote itself]");
  // The API shape is genuinely confusing and worth stating once: the **path**
  // username is the *acting* user; the body's `username` is the *target*. `gate()`
  // requires `managesOnlySelf(actor, pathUsername)`, so putting the target in the
  // path returns `401 forbidden` even when the caller holds every right -- which is
  // what my first version did, and it read like a broken permission model rather
  // than a wrong argument.
  const escalate = async (page, actorUser, targetUser) =>
    page.evaluate(async ([api, ns, actor, u]) => {
      const raw = window.localStorage.getItem("persist:root");
      const auth = JSON.parse(JSON.parse(raw).auth);
      const fd = new FormData();
      fd.append("username", u);
      fd.append("namespace", ns);
      fd.append("uuid", auth.uuid ?? "");
      const r = await fetch(`${api}/${actor}/namespace/admin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
        body: fd,
      });
      let b = null;
      try { b = await r.json(); } catch {}
      return { status: r.status, body: b };
    }, [API, NS, actorUser, targetUser]);

  // The outsider is in no namespace at all.
  const outTry = await escalate(outsider.page, outsider.USER, outsider.USER);
  check("a non-member cannot add themselves as namespace admin",
    outTry.status >= 400, `${outTry.status} ${JSON.stringify(outTry.body)?.slice(0, 70)}`);
  check("  and the refusal is marked forbidden, not an expired session (D65)",
    outTry.body?.reason === "forbidden", `reason=${outTry.body?.reason}`);

  const stillAdmins = await nsCol.findOne({ namespace: NS });
  check("  and the admins list did not change",
    !String(stillAdmins.admins ?? []).includes(String(outsiderDoc._id)),
    `admins=${JSON.stringify(stillAdmins.admins)}`);

  // A maintainer may not grant admin. (v2.0.1 requires namespace admin even to
  // add a maintainer, so this is the documented asymmetry the audit preserved.)
  await nsCol.updateOne({ namespace: NS }, { $addToSet: { maintainers: outsiderDoc._id } });
  const mntTry = await escalate(outsider.page, outsider.USER, outsider.USER);
  check("a plain maintainer cannot grant namespace admin",
    mntTry.status >= 400, `${mntTry.status} ${JSON.stringify(mntTry.body)?.slice(0, 70)}`);
  const afterMnt = await nsCol.findOne({ namespace: NS });
  check("  and still is not an admin",
    !String(afterMnt.admins ?? []).includes(String(outsiderDoc._id)));

  // ── revocation ─────────────────────────────────────────────────────────────
  console.log("\n[revocation]");
  const ownerPost = (path, targetUser) =>
    owner.page.evaluate(async ([api, p, actor, u]) => {
      const raw = window.localStorage.getItem("persist:root");
      const auth = JSON.parse(JSON.parse(raw).auth);
      const fd = new FormData();
      // Field names matter: the Worker reads `username` and `namespace`. The React
      // action maps its internal `username_to_be_added` onto `username` before
      // sending, and my first version skipped that mapping -- so every refusal came
      // back as `400 "Please enter username"`, which reads like a validation failure
      // rather than the authorisation decision actually being tested.
      fd.append("username", u);
      fd.append("namespace", window.__NSNAME__ ?? "");
      const r = await fetch(`${api}/${actor}${p}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
        body: fd,
      });
      let b = null;
      try { b = await r.json(); } catch {}
      return { status: r.status, body: b };
    }, [API, path, owner.USER, targetUser]);

  // ── the other three dialogs, each actually opened ─────────────────────────
  console.log("\n[the other three membership dialogs]");

  await owner.page.goto(`${APP}/manage/projects`, { waitUntil: "networkidle" });
  await until(() => owner.page.locator(`text=${NS}`).count());
  await owner.page.waitForTimeout(700);

  // Add Maintainer -- a different dialog, reducer and action from Add Admin.
  {
    const d = await openDialog("Add Maintainer");
    check("the Add Maintainer dialog opens", !!d);
    if (d) {
      t = await submitMember(d, outsider.USER);
      check("the owner can add a namespace maintainer through the dialog",
        /success|added/i.test(t) && !/error|failed/i.test(t),
        (t.match(/[A-Z][^.]*added[^.]*\./i) ?? [""])[0] || t.slice(0, 100));
      const d2 = await nsCol.findOne({ namespace: NS });
      check("  and they are really in maintainers",
        String(d2.maintainers ?? []).includes(String(outsiderDoc._id)),
        `maintainers=${JSON.stringify(d2.maintainers)}`);
      await closeDialog(d);
    }
  }

  // Remove Maintainer.
  {
    const d = await openDialog("Remove Maintainer");
    check("the Remove Maintainer dialog opens", !!d);
    if (d) {
      t = await submitMember(d, outsider.USER);
      check("the owner can remove a namespace maintainer through the dialog",
        /success|removed/i.test(t) && !/error|failed/i.test(t),
        (t.match(/[A-Z][^.]*removed[^.]*\./i) ?? [""])[0] || t.slice(0, 100));
      const d2 = await nsCol.findOne({ namespace: NS });
      check("  and they are gone from maintainers",
        !String(d2.maintainers ?? []).includes(String(outsiderDoc._id)),
        `maintainers=${JSON.stringify(d2.maintainers)}`);
      await closeDialog(d);
    }
  }

  // Remove Admin.
  {
    const d = await openDialog("Remove Admin");
    check("the Remove Admin dialog opens", !!d);
    if (d) {
      t = await submitMember(d, grantee.USER);
      check("the owner can remove a namespace admin through the dialog",
        /success|removed/i.test(t) && !/error|failed/i.test(t),
        (t.match(/[A-Z][^.]*removed[^.]*\./i) ?? [""])[0] || t.slice(0, 100));
      const d2 = await nsCol.findOne({ namespace: NS });
      check("  and they are gone from admins",
        !String(d2.admins ?? []).includes(String(granteeDoc._id)),
        `admins=${JSON.stringify(d2.admins)}`);
      await closeDialog(d);
    }
  }

  // ── revocation is real ─────────────────────────────────────────────────────
  // Set directly rather than via `addInitScript`: that only runs on the *next*
  // navigation, and this probe runs on a page that is already loaded, so
  // `window.__NSNAME__` was still undefined and the request went out with an empty
  // namespace -- `400 "Please enter namespace name"`, which the check was content to
  // read as a refusal.
  await grantee.page.evaluate((n) => { window.__NSNAME__ = n; }, NS);

  await grantee.page.evaluate(async ([api, actor, u]) => {
    const raw = window.localStorage.getItem("persist:root");
    const auth = JSON.parse(JSON.parse(raw).auth);
    const fd = new FormData();
    // Same field names the Worker reads. An earlier revision of this probe still sent
    // `username_to_be_added` / `namespace_name` -- the *internal* names -- so it got
    // `400 "Please enter username"` and the check counted that as "refused". The
    // assertion below now insists on `401` **and** `reason: forbidden`, so a probe
    // with the wrong fields fails loudly instead of passing on a validation error.
    fd.append("username", u);
    fd.append("namespace", window.__NSNAME__ ?? "");
    const r = await fetch(`${api}/${actor}/namespace/admin`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      body: fd,
    });
    window.__lastStatus = r.status;
    try {
      const b = await r.json();
      window.__lastReason = b.reason;
      window.__lastMessage = b.message;
    } catch {
      window.__lastReason = "(no json)";
    }
  }, [API, grantee.USER, outsider.USER]).catch(() => {});
  await grantee.page.waitForTimeout(900);
  const postRevoke = await grantee.page.evaluate(() => ({
    status: window.__lastStatus,
    reason: window.__lastReason,
    message: window.__lastMessage,
  }));
  check("a revoked admin can no longer grant admin",
    postRevoke.status === 401 && postRevoke.reason === "forbidden",
    `${postRevoke.status} ${postRevoke.reason ?? "(no reason)"} — ${postRevoke.message}`);
  check("  and it is refused as forbidden, not rejected as a malformed request",
    postRevoke.reason === "forbidden",
    "a 400 would mean the probe sent the wrong fields and proved nothing");

  // ── hygiene ────────────────────────────────────────────────────────────────
  console.log("\n[hygiene]");
  check("no uncaught exceptions", pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | ").slice(0, 140));
  // Defect D117: this computed exactly the 5xx and unexpected-404 calls the
  // journey should never make, and then only `console.log`'d them. The one
  // assertion that would catch a 500 anywhere in the membership flow was
  // collected and thrown away, so the harness exited 0 having checked nothing
  // about API health. It is now a check.
  const unexpected = calls.filter(
    (c) => /^5\d\d/.test(c) || c.includes("namespace/admin") === false && /^404/.test(c) && !c.includes("users/"),
  );
  check("no 5xx and no unexpected 404 from any membership call",
    unexpected.length === 0,
    unexpected.slice(0, 3).join(" | "));
  if (unexpected.length) console.log(`         calls: ${JSON.stringify(calls.slice(0, 12))}`);

  await nsCol.deleteMany({ namespace: NS });
  await owner.cleanup();
  await grantee.cleanup();
  await outsider.cleanup();
  await client.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ${f.n}: ${f.d}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});