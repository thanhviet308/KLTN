import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';

export interface SpamPrediction {
  label: boolean;
  score: number;
  model: string;
}

@Injectable()
export class SpamDetectionService {
  private readonly logger = new Logger(SpamDetectionService.name);

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async predict(message: string): Promise<SpamPrediction | null> {
    const origin = this.config.get('SPAM_DETECTION_URL', { infer: true });
    if (!origin) return null;
    try {
      const response = await fetch(`${origin}/api/predict`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(1200),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object') throw new Error('INVALID_BODY');
      const result = value as Record<string, unknown>;
      if (
        ![0, 1].includes(result.label as number) ||
        typeof result.risk_score !== 'number' ||
        !Number.isFinite(result.risk_score) ||
        result.risk_score < 0 ||
        result.risk_score > 1 ||
        typeof result.model !== 'string' ||
        !result.model.trim() ||
        result.model.length > 100
      )
        throw new Error('INVALID_RESULT');
      return {
        label: result.label === 1,
        score: result.risk_score,
        model: result.model,
      };
    } catch (error) {
      this.logger.warn(
        `Spam detection unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }
}
