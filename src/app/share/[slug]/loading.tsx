import { Loader2Icon } from "lucide-react";

export default function ShareLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0a0a0a]">
      <Loader2Icon className="size-6 animate-spin text-foreground/40" />
    </div>
  );
}
