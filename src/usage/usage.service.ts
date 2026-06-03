import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsageSummary } from './usage.types';

/**
 * Tracks monthly token consumption against the subscription plan.
 *
 * In-memory for now (resets on restart); swap for a DB-backed per-merchant
 * counter later. Plan size and starting usage are env-configurable.
 */
@Injectable()
export class UsageService {
  private readonly planName: string;
  private readonly totalTokens: number;
  private usedTokens: number;

  constructor(config: ConfigService) {
    this.planName = config.get<string>('PLAN_NAME') ?? 'الباقة الشهرية';
    this.totalTokens = Number(config.get('PLAN_MONTHLY_TOKENS') ?? 1000);
    this.usedTokens = Number(config.get('PLAN_USED_TOKENS') ?? 250);
  }

  /** Record token consumption (clamped to the plan total). */
  consume(tokens: number): void {
    if (tokens <= 0) return;
    this.usedTokens = Math.min(this.totalTokens, this.usedTokens + tokens);
  }

  getSummary(): UsageSummary {
    const remainingTokens = Math.max(0, this.totalTokens - this.usedTokens);
    const percentUsed =
      this.totalTokens > 0
        ? Math.round((this.usedTokens / this.totalTokens) * 100)
        : 0;
    return {
      plan: this.planName,
      totalTokens: this.totalTokens,
      usedTokens: this.usedTokens,
      remainingTokens,
      percentUsed,
    };
  }
}
