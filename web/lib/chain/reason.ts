import { REASON_MEANING, type ReasonCode } from "@/content/reasons";

export interface ReasonDisplay {
  /** Shown first. */
  label: string;
  /** Shown after the label, as a small mono tag. */
  code: ReasonCode;
  /** One plain sentence. */
  meaning: string;
}

/**
 * The one place the ledger turns a reason code into text. When content/reasons.ts gains REASON_LABEL (another branch
 * adds plain labels such as "Market closed"), `label` becomes REASON_LABEL[code].
 */
export function reasonDisplay(code: ReasonCode): ReasonDisplay {
  return { label: code, code, meaning: code === "OK" ? "Every check passed." : REASON_MEANING[code] };
}
