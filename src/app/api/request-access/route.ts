import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { z } from "zod";

import { generateAccessToken } from "@/lib/access-token";

// POST /api/request-access
// Public endpoint behind the "Request access" form at batch-apps.com. Validates
// the applicant, then emails the admin a notification with signed Approve/Deny
// links. No database writes happen here: approval is what provisions the user.

const requestSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.email("A valid email is required").max(254),
  referral: z.string().trim().max(500).optional(),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { name, email, referral } = parsed.data;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const adminEmail = process.env.BATCHPORT_ADMIN_EMAIL;
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!appUrl || !adminEmail || !resendApiKey) {
    return NextResponse.json(
      { error: "Server is not configured to accept access requests" },
      { status: 500 },
    );
  }

  // The Approve/Deny links carry the email and an HMAC token tying that email
  // to APPROVAL_SECRET, so the admin links cannot be forged or replayed for a
  // different address.
  const token = generateAccessToken(email);
  const query = `email=${encodeURIComponent(email)}&token=${token}`;
  const approveUrl = `${appUrl}/api/approve-access?${query}`;
  const denyUrl = `${appUrl}/api/deny-access?${query}`;

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeReferral = referral ? escapeHtml(referral) : "Not provided";

  const html = `
    <div style="background:#0a0a0a;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#111111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:28px 28px 8px 28px;">
            <h1 style="margin:0;color:#fafafa;font-size:18px;font-weight:600;">BatchPort access request</h1>
            <p style="margin:6px 0 0 0;color:#a1a1aa;font-size:14px;">Someone requested access to BatchPort.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#e4e4e7;">
              <tr>
                <td style="padding:8px 0;color:#71717a;width:96px;">Name</td>
                <td style="padding:8px 0;color:#fafafa;">${safeName}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#71717a;border-top:1px solid #1f1f1f;">Email</td>
                <td style="padding:8px 0;color:#fafafa;border-top:1px solid #1f1f1f;">${safeEmail}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#71717a;border-top:1px solid #1f1f1f;">Referral</td>
                <td style="padding:8px 0;color:#fafafa;border-top:1px solid #1f1f1f;">${safeReferral}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 28px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:10px;">
                  <a href="${approveUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">Approve</a>
                </td>
                <td>
                  <a href="${denyUrl}" style="display:inline-block;background:#1f1f1f;color:#e4e4e7;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;border:1px solid #2a2a2a;">Deny</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>`;

  try {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({
      from: "BatchPort <noreply@batch-apps.com>",
      to: adminEmail,
      subject: `BatchPort Access Request - ${name}`,
      html,
    });
    if (error) {
      return NextResponse.json(
        { error: "Could not send the access request. Please try again." },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not send the access request. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
