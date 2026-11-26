// @vitest-environment node
import { expect, it, vi } from "vitest";
import { cardModel, HIDDEN_BRIEF_TEXT, HIDDEN_REPLY } from "@/lib/card/model";
import { AGENT, cardCase } from "./helpers/card";
import { VECTORS } from "./helpers/maat-v1";

// The card reads the owner's /ask hide-list (content/ask-hidden.ts), as the /ask feed does. The list is empty today, so
// this file stands in one that holds brief 7, the brief the spec's vector V5 adopts.
vi.mock("@/content/ask-hidden", () => ({ HIDDEN_BRIEFS: [7] }));

it("hides a brief on the owner's /ask hide-list, and the reply to it, without being told", () => {
  const read = cardCase({ from: AGENT, blob: VECTORS.V5.blob, briefs: [{ id: 7, text: "abusive text", from: AGENT, reply: "a reply that quotes it" }] });
  expect(cardModel(read).briefs).toEqual([
    { id: 7, head: "Brief #7 · from 0x0000…6E17", text: HIDDEN_BRIEF_TEXT, reply: HIDDEN_REPLY, hasText: false, hasReply: false },
  ]);
});
