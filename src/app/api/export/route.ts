import { NextResponse, type NextRequest } from "next/server";

import {
  buildExpenseCsvExport,
  buildExportGeoJson,
  buildExportJson,
  exportFilename,
  EXPORT_FORMATS,
  type ExportFormat,
} from "@/lib/export-data";

// GET /api/export?format=json|geojson
//
// Downloads the caller's own data. There is no user parameter by design: the
// builders read through the session-scoped Supabase client, so RLS decides what
// comes back and no request can name another account. An unauthenticated
// request gets a 401 rather than an empty file.
//
// The demo account may export. It is read-only, its data is already public at
// /demo, and a working download is part of what the demo demonstrates.

function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get("format") ?? "json").trim();
  if (!isExportFormat(raw)) {
    return NextResponse.json(
      { error: "format must be json, geojson, or expenses-csv" },
      { status: 400 },
    );
  }

  let body: string;
  try {
    body =
      raw === "geojson"
        ? await buildExportGeoJson()
        : raw === "expenses-csv"
          ? await buildExpenseCsvExport()
          : await buildExportJson();
  } catch {
    // requireUser throws when there is no session; anything else is a genuine
    // failure and neither case should leak detail to the client.
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type":
        raw === "geojson"
          ? "application/geo+json; charset=utf-8"
          : raw === "expenses-csv"
            ? "text/csv; charset=utf-8"
            : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(raw)}"`,
      // A download is a snapshot of live data; never let a proxy reuse one.
      "Cache-Control": "no-store",
    },
  });
}
