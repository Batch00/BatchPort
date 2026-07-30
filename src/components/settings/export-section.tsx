import { DownloadIcon, FileJsonIcon, GlobeIcon } from "lucide-react";

// Download links for the two export formats. Plain anchors, not fetch: the
// route already sets Content-Disposition, so the browser handles the save
// dialog and a large file never has to sit in a JS blob first. The download
// attribute is a hint only; the header is what names the file.

function ExportLink({
  format,
  title,
  description,
  icon,
}: {
  format: "json" | "geojson";
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={`/api/export?format=${format}`}
      download
      className="group flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-brand/40"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <DownloadIcon className="mt-1 size-4 shrink-0 text-foreground/35 transition-colors group-hover:text-brand" />
    </a>
  );
}

export function ExportSection() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">Export your data</p>
        <p className="text-xs text-muted-foreground">
          Everything you have logged, in an open format, whenever you want it.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ExportLink
          format="json"
          title="JSON archive"
          description="Trips, destinations, experiences, bucket list, photo metadata, and settings."
          icon={<FileJsonIcon className="size-4" />}
        />
        <ExportLink
          format="geojson"
          title="GeoJSON map"
          description="Destinations as points and trips as routes. Opens in geojson.io or any GIS tool."
          icon={<GlobeIcon className="size-4" />}
        />
      </div>
    </div>
  );
}
