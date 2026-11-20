import { REASON_LABEL, REASON_MEANING, type ReasonCode } from "@/content/reasons";

export interface ReasonDisplay {
  /** Shown first. */
  label: string;
  /** Shown after the label, as a small mono tag. */
  code: ReasonCode;
  /** One plain sentence. */
  meaning: string;
}

/**
 * The one place the ledger turns a reason code into text: the plain label from REASON_LABEL, the code itself, and the
 * sentence from REASON_MEANING (for OK, the label as a sentence).
 */
export function reasonDisplay(code: ReasonCode): ReasonDisplay {
  return { label: REASON_LABEL[code], code, meaning: code === "OK" ? `${REASON_LABEL.OK}.` : REASON_MEANING[code] };
}
