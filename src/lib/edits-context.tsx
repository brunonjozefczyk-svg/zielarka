import { createContext, useContext, type ReactNode } from "react";
import type { ManagedEntry } from "./entries";
import type { HerbCopy } from "./herb-editor";
import type { TextStyle, ThemeSettings } from "./theme";

export type PublicEdits = {
  revision: number;
  copy: Record<string, string>;
  images: Record<string, string>;
  herbs: Record<string, HerbCopy>;
  entries: ManagedEntry[];
  theme: ThemeSettings | null;
  styles: Record<string, TextStyle>;
  storeOk?: boolean;
};

const empty: PublicEdits = {
  revision: 0,
  copy: {},
  images: {},
  herbs: {},
  entries: [],
  theme: null,
  styles: {},
};

const EditsContext = createContext<PublicEdits>(empty);

export function EditsProvider({ value, children }: { value: PublicEdits; children: ReactNode }) {
  return <EditsContext.Provider value={value}>{children}</EditsContext.Provider>;
}

export function useEdits() {
  return useContext(EditsContext);
}
