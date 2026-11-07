"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Loaded on first use, so the search code stays out of the docs first load.
const SearchDialog = dynamic(() => import("./SearchDialog"), { ssr: false });

/**
 * Fumadocs providers for /docs only: static search, and a light-by-default theme the reader can switch.
 * hotKey: false turns off Fumadocs' single-key "d" theme toggle, easy to hit by accident.
 */
export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog }} theme={{ defaultTheme: "light", enableSystem: false, hotKey: false }}>
      {children}
    </RootProvider>
  );
}
