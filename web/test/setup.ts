import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const realFetch = globalThis.fetch;

// No unit test reaches the network. Rendering the landing starts the live strip's first read, which would call a public
// RPC; a test that needs answers injects a reader. A data: URL is read in memory, not from the network, so it still
// works (test/search.test.ts downloads its index from one). Re-applied before each test, since a test may unstub globals.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("data:")) return realFetch(input, init);
      return Promise.reject(new TypeError("network is disabled in unit tests"));
    }),
  );
});

afterEach(() => cleanup());
