import { getRequestIP } from "@tanstack/react-start/server";

export function editorClientKey() {
  try {
    return getRequestIP({ xForwardedFor: true }) || "local";
  } catch {
    return "local";
  }
}
