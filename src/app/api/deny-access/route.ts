import { type NextRequest } from "next/server";

import { verifyAccessToken } from "@/lib/access-token";

// GET /api/deny-access?email=...&token=...
// The admin reaches this by clicking Deny in the notification email. It verifies
// the signed token and renders a confirmation page. No email is sent to the
// applicant: a denial is silent.

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
       <p style="margin:0;color:#a1a1aa;font-size:14px;">This link could not be verified.</p>`,
      400,
    );
  }

  return page(
    "Access denied",
    `<h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;">Access request denied</h1>
     <p style="margin:0;color:#a1a1aa;font-size:14px;">No invitation was sent. You can close this tab.</p>`,
  );
}
