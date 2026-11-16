"use client";

import { useStaticSearch } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  useSearch,
} from "fumadocs-ui/components/dialog/search";
import type { SharedProps } from "fumadocs-ui/contexts/search";
import { useState } from "react";

const status = "px-3 py-10 text-center text-sm text-fd-muted-foreground";

function NoResults() {
  const { query } = useSearch();
  return (
    <p role="status" className={status}>
      No results for &quot;{query}&quot;. Try a reason code like MARKET_CLOSED.
    </p>
  );
}

/**
 * The list body: results, or one clear state. The static client caches a failed index download for its URL,
 * so "Try again" asks for the index under a new query string.
 */
function Results({ onRetry }: { onRetry: () => void }) {
  const { search, isLoading, data, error } = useSearch();
  if (error && !data) {
    return (
      <div role="alert" className={status}>
        <p>Search is unavailable. Check your connection and try again.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-11 items-center rounded-md border border-fd-border px-3 font-medium text-fd-foreground hover:bg-fd-accent md:min-h-9"
        >
          Try again
        </button>
      </div>
    );
  }
  if (isLoading && !data && search) {
    return (
      <p role="status" className={status}>
        Searching...
      </p>
    );
  }
  return <SearchDialogList Empty={() => <NoResults />} />;
}

/** Ctrl/Cmd+K search over the index exported to /api/search at build time; runs entirely in the browser. */
export default function DocsSearchDialog(props: SharedProps) {
  const [attempt, setAttempt] = useState(0);
  const search = useStaticSearch({ from: attempt === 0 ? "/api/search" : `/api/search?attempt=${attempt}` });
  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <Results onRetry={() => setAttempt((n) => n + 1)} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
