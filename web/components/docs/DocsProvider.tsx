"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

/**
 * Fumadocs providers for /docs only: a light-by-default theme the reader can switch. Search arrives with its
 * index in the next task. hotKey: false turns off Fumadocs' single-key "d" theme toggle, easy to hit by accident.
 */
export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ enabled: false }} theme={{ defaultTheme: "light", enableSystem: false, hotKey: false }}>
      {children}
    </RootProvider>
  );
}
