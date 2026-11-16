"use client";

import { experimental_useSearch as useIndexSearch } from "fumadocs-core/search/client";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SearchItemType,
  useSearch,
} from "fumadocs-ui/components/dialog/search";
import type { SharedProps } from "fumadocs-ui/contexts/search";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { create } from "zbsearch";
import { SEARCH_INDEX_URL, SEARCH_PARAMS, SEARCH_START_PAGES, searchTokenizer, titleFirst } from "@/lib/docs/search";

const status = "px-3 py-10 text-center text-sm text-fd-muted-foreground";
const link = "font-medium text-fd-primary underline underline-offset-4";

// The index was built with this tokenizer's settings (app/api/search.json/route.ts); queries and titles use it too.
const tokenizer = searchTokenizer();
const tokenize = (text: string) => tokenizer.tokenize(text);
const initDB = () => create({ schema: { _: "string" }, components: { tokenizer } });

const START: SearchItemType[] = SEARCH_START_PAGES.map(({ label, url }) => ({ id: url, type: "page", url, content: label }));

function NoResults() {
  const { query, onOpenChange } = useSearch();
  const close = () => onOpenChange(false);
  return (
    <p role="status" className={status}>
      No results for &quot;{query}&quot;. Try a reason code like MARKET_CLOSED, or browse the{" "}
      <Link href="/docs/help/faq" onClick={close} className={link}>
        FAQ
      </Link>{" "}
      and the{" "}
      <Link href="/docs/help/glossary" onClick={close} className={link}>
        Glossary
      </Link>
      .
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
  return <SearchDialogList defaultItems={START} Empty={() => <NoResults />} />;
}

/** Ctrl/Cmd+K search over the index exported to /api/search.json at build time; runs entirely in the browser. */
export default function DocsSearchDialog(props: SharedProps) {
  const [attempt, setAttempt] = useState(0);
  const client = useMemo(
    () => staticClient({ from: attempt === 0 ? SEARCH_INDEX_URL : `${SEARCH_INDEX_URL}?attempt=${attempt}`, initDB, search: SEARCH_PARAMS }),
    [attempt],
  );
  const run = useCallback(async (query: string) => titleFirst(await client.search(query), query, tokenize), [client]);
  const search = useIndexSearch(run);

  // The index downloads when the reader reaches for search: the dialog opens, or the pointer or the focus reaches a
  // search button. Never with the page. A blank query loads it into the client's cache and matches nothing.
  const { open } = props;
  useEffect(() => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      // A failed download shows when the reader searches, with "Try again".
      Promise.resolve(client.search(" ")).catch(() => {});
    };
    if (open) start();
    const onIntent = (e: Event) => {
      if (e.target instanceof Element && e.target.closest("[data-search], [data-search-full]")) start();
    };
    document.addEventListener("pointerover", onIntent);
    document.addEventListener("focusin", onIntent);
    return () => {
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("focusin", onIntent);
    };
  }, [client, open]);

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
