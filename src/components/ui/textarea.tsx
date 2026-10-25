import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-32 w-full rounded-md border border-line bg-cream px-3 py-3 text-base text-ink placeholder:text-muted/80",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest",
        className,
      )}
      {...props}
    />
  );
}
