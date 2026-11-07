"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Kept out of the first-load bundle: the dialog code loads after hydration so Ctrl+K opens at once, and the search index (/api/search) loads on the first query.
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
