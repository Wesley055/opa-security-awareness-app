import { Injectable } from '@nestjs/common';

export interface ConfidenceInput {
  voiceMatched?: boolean;
  voiceConfidence?: number;
  repetitionCount?: number;
  userConfirmed?: boolean;
  deviceInMotion?: boolean;
  isOffline?: boolean;
}

export interface ConfidenceResult {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: string[];
  provider: string;
}

@Injectable()
export class ConfidenceProvider {
  readonly providerName = 'IncidentConfidenceProvider';

  calculate(input: ConfidenceInput): ConfidenceResult {
    let score = 0;
    const factors: string[] = [];

    if (input.voiceMatched === true) {
      score += 35;
      factors.push('Configured voice trigger matched.');
    }

    if ((input.voiceConfidence ?? 0) >= 0.9) {
      score += 20;
      factors.push('Voice confidence is very high.');
    } else if ((input.voiceConfidence ?? 0) >= 0.75) {
      score += 10;
      factors.push('Voice confidence is moderate.');
    }

    if ((input.repetitionCount ?? 0) >= 2) {
      score += 15;
      factors.push('Trigger phrase was repeated.');
    }

    if (input.userConfirmed === true) {
      score += 20;
      factors.push('User confirmed the emergency.');
    }

    if (input.deviceInMotion === true) {
      score += 5;
      factors.push('Device movement detected.');
    }

    if (input.isOffline === true) {
      score += 5;
      factors.push('Device is offline during the trigger event.');
    }

    score = Math.min(score, 100);

    return {
      score,
      level: this.getLevel(score),
      factors,
      provider: this.providerName,
    };
  }

  private getLevel(
    score: number,
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= 85) {
      return 'CRITICAL';
    }

    if (score >= 65) {
      return 'HIGH';
    }

    if (score >= 40) {
      return 'MEDIUM';
    }

    return 'LOW';
  }
}