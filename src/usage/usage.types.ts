export interface UsageSummary {
  plan: string;
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
  /** 0–100, used / total. */
  percentUsed: number;
}
