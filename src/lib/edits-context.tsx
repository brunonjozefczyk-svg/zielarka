import { createContext, useContext, type ReactNode } from "react";
import type { ManagedEntry } from "./entries";
import type { HerbCopy } from "./herb-editor";

export type PublicEdits = {
  revision: number;
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, HerbCopy>;
  entries: ManagedEntry[];
};

const empty: PublicEdits = { revision: 0, copy: {}, images: {}, herbs: {}, entries: [] };

const EditsContext = createContext<PublicEdits>(empty);

export function EditsProvider({ value, children }: { value: PublicEdits; children: ReactNode }) {
  return <EditsContext.Provider value={value}>{children}</EditsContext.Provider>;
}

export function useEdits() {
  return useContext(EditsContext);
}
