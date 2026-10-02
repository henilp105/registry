/**
 * Transactional email over HTTPS.
 *
 * `v2.0.1` already replaced SMTP with the Brevo HTTP API
 * (`backend/mail.py`), and that change is what makes the serverless move
 * possible at all: outbound TCP to `smtp.gmail.com:587` from a Cloudflare
 * Worker is blocked, and the original `main` version connected to SMTP at
 * **module import time**, so a Worker that could not reach :587 would fail to
 * boot and never serve a request. See defect S9/S10 in
 * docs/BASELINE_AUDIT.md.
 *
 * Brevo's free tier is 300 emails/day, which is comfortable for verification
 * and password-reset traffic on a package registry.
 *
 * ── Enumeration safety ───────────────────────────────────────────────────────
 * `v2.0.1` returns 404 "User not found" from `/auth/forgot-password`, which is
 * a user-enumeration oracle (documented in `docs/authentication.md:166-168` as
 * "intentionally vague" but not implemented that way). We always return 200
 * with the same message regardless of whether the address exists.
 */

import type { Env } from "../db/client";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export type SendResult = { sent: boolean; reason?: string };

/** HTML-escape. Every interpolated value goes through this. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send an email via Brevo.
 *
 * Never throws — a failed verification email must not turn a successful signup
 * into a 500. `sent: false` is logged and the caller decides.
 */
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  textBody: string,
): Promise<SendResult> {
  if (!env.BREVO_API_KEY) {
    console.warn("BREVO_API_KEY not set; skipping email", { to, subject });
    return { sent: false, reason: "not_configured" };
  }

  const payload = {
    sender: {
      email: env.BREVO_SENDER_EMAIL ?? "noreply@registry.fortran-lang.org",
      name: env.BREVO_SENDER_NAME ?? "FPM Registry",
    },
    to: [{ email: to }],
    subject,
    htmlContent: `<html><body>${escapeHtml(textBody).replace(/\n/g, "<br>")}</body></html>`,
    textContent: textBody,
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("brevo send failed", res.status, detail.slice(0, 200));
      return { sent: false, reason: `upstream_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("brevo send threw", err instanceof Error ? err.message : err);
    return { sent: false, reason: "network" };
  }
}

export async function sendVerificationEmail(
  env: Env,
  to: string,
  username: string,
  uuid: string,
): Promise<SendResult> {
  const body = [
    `Dear ${username},`,
    "",
    "We received a request to verify your email address for the fpm registry.",
    "To verify your email, open the link below in a new browser window:",
    "",
    `${env.HOST}/account/verify/${uuid}`,
    "",
    "If you did not create this account you can safely ignore this message.",
    "",
    "Thank you,",
    "The Fortran-lang Team",
  ].join("\n");

  return sendEmail(env, to, "Verify your fpm registry email", body);
}

export async function sendPasswordResetEmail(
  env: Env,
  to: string,
  username: string,
  uuid: string,
): Promise<SendResult> {
  const body = [
    `Dear ${username},`,
    "",
    "We received a request to reset your password.",
    "To reset your password, open the link below in a new browser window:",
    "",
    `${env.HOST}/account/reset-password/${uuid}`,
    "",
    "This link is valid for one hour. If you did not request a password reset you",
    "can safely ignore this message and your password will remain unchanged.",
    "",
    "Thank you,",
    "The Fortran-lang Team",
  ].join("\n");

  return sendEmail(env, to, "Reset your fpm registry password", body);
}

export async function sendEmailChangeConfirmation(
  env: Env,
  to: string,
  username: string,
  uuid: string,
): Promise<SendResult> {
  const body = [
    `Dear ${username},`,
    "",
    "We received a request to change the email address on your fpm registry account.",
    "Confirm the change by opening the link below in a new browser window:",
    "",
    `${env.HOST}/account/verify/${uuid}`,
    "",
    "If you did not request this change, please ignore this message.",
    "",
    "Thank you,",
    "The Fortran-lang Team",
  ].join("\n");

  return sendEmail(env, to, "Confirm your new fpm registry email", body);
}