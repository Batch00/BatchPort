// IMPORTANT: For the invite link to work, the Supabase dashboard must list
//   https://batchport.batch-apps.com/auth/setup-password
// under Authentication > URL Configuration > Redirect URLs (add the
// http://localhost:3000 variant for local testing too). If the redirect URL is
// missing, Supabase strips redirectTo and the invite link fails silently.

import { type NextRequest } from "next/server";
import { Resend } from "resend";

import { verifyAccessToken } from "@/lib/access-token";
import { createAdminClient } from "@/utils/supabase/admin";

// GET /api/approve-access?email=...&token=...
// The admin reaches this by clicking Approve in the notification email. It
// verifies the signed token, invites the user via Supabase, emails them a
// "check your inbox" note, and renders a confirmation page back to the admin.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;background:#0a0a0a;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
      <div style="max-width:420px;width:100%;background:#111111;border:1px solid #1f1f1f;border-radius:12px;padding:32px;text-align:center;">
        ${body}
      </div>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  const token = searchParams.get("token");

  if (!email || !token || !verifyAccessToken(email, token)) {
    return page(
      "Invalid link",
      `<h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;">Invalid or expired link</h1>
       <p style="margin:0;color:#a1a1aa;font-size:14px;">This approval link could not be verified.</p>`,
      400,
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return page(
      "Not configured",
      `<h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;">Server not configured</h1>
       <p style="margin:0;color:#a1a1aa;font-size:14px;">NEXT_PUBLIC_APP_URL is missing.</p>`,
      500,
    );
  }

  const supabase = createAdminClient();
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${appUrl}/auth/setup-password` },
  );
  if (inviteError) {
    return page(
      "Invite failed",
      `<h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;">Could not send invite</h1>
       <p style="margin:0;color:#a1a1aa;font-size:14px;">${escapeHtml(inviteError.message)}</p>`,
      502,
    );
  }

  // Best-effort welcome note. The Supabase invite email is what actually lets
  // the user in, so a failure here does not block approval.
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    const welcomeHtml = `
      <div style="background:#0a0a0a;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#111111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:32px 28px;">
              <h1 style="margin:0 0 12px 0;color:#fafafa;font-size:20px;font-weight:600;">You have been invited to BatchPort</h1>
              <p style="margin:0 0 16px 0;color:#d4d4d8;font-size:14px;line-height:1.6;">Your access has been approved. Please check your inbox for an invitation email with a link to set your password.</p>
              <p style="margin:0;color:#71717a;font-size:13px;line-height:1.6;">BatchPort is your personal travel tracker.</p>
            </td>
          </tr>
        </table>
      </div>`;
    try {
      const resend = new Resend(resendApiKey);
      await resend.emails.send({
        from: "BatchPort <noreply@batch-apps.com>",
        to: email,
        subject: "You've been invited to BatchPort",
        html: welcomeHtml,
      });
    } catch {
      // Ignore: the Supabase invite email is the source of truth.
    }
  }

  return page(
    "Access approved",
    `<div style="width:44px;height:44px;margin:0 auto 16px auto;border-radius:50%;background:#2563eb;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;">&#10003;</div>
     <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;">Access approved</h1>
     <p style="margin:0;color:#a1a1aa;font-size:14px;">Invite sent to ${escapeHtml(email)}.</p>`,
  );
}
