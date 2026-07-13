import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import {
  getBucketList,
  getBucketListStats,
  getCountries,
} from "@/lib/bucket-list";
import { getTripOptions } from "@/lib/trips";
import { BucketListBoard } from "@/components/bucket-list/bucket-list-board";

export const metadata = { title: "Bucket List" };

// The bucket list page. Server component: it resolves the current user (the demo
// account when signed in as the demo) and hands the data to the client board.
export default async function BucketListPage() {
  const { user } = await requireUser();
  const [items, stats, countries, tripOptions] = await Promise.all([
    getBucketList(user.id),
    getBucketListStats(user.id),
    getCountries(),
    getTripOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl p-6 sm:p-8">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to dashboard
      </Link>

      <BucketListBoard
        items={items}
        countries={countries}
        trips={tripOptions}
        stats={stats}
        isDemo={isDemoUser(user.id)}
      />
    </div>
  );
}
