import crypto from "node:crypto";

// HMAC-SHA256 tokens that authenticate the Approve/Deny links in the admin
// notification email. The token binds an applicant's email to APPROVAL_SECRET,
// so only someone holding the secret (the email we sent) can approve or deny.
//
// Server only: depends on APPROVAL_SECRET and node:crypto.

function getSecret(): string {
  const secret = process.env.APPROVAL_SECRET;
  if (!secret) {
    throw new Error("APPROVAL_SECRET is not set");
  }
  return secret;
}

// Lowercase + trim so the same address always yields the same token regardless
// of how the applicant typed it.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateAccessToken(email: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(normalizeEmail(email))
    .digest("hex");
}

// Timing-safe comparison of a presented token against the expected one. Guards
// against length mismatches (timingSafeEqual throws on unequal lengths) and any
// non-hex input.
export function verifyAccessToken(email: string, token: string): boolean {
  const expected = generateAccessToken(email);
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(token, "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
