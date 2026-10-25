import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-md border border-line bg-cream px-3 text-base text-ink placeholder:text-muted/80",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest",
        className,
      )}
      {...props}
    />
  );
}
