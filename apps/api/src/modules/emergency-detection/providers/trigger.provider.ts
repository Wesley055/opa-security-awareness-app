import { Injectable } from '@nestjs/common';
import {
  EmergencyTriggerType,
  TriggerMode,
} from '../dto/trigger-request.dto';

export interface TriggerDecisionInput {
  triggerType: EmergencyTriggerType;
  mode: TriggerMode;
  voiceMatched?: boolean;
  userConfirmed?: boolean;
  cancellationReceived?: boolean;
  confirmationSeconds?: number;
}

export interface TriggerDecisionResult {
  shouldActivate: boolean;
  requiresConfirmation: boolean;
  isSilent: boolean;
  delaySeconds: number;
  reason: string;
  provider: string;
}

@Injectable()
export class TriggerProvider {
  readonly providerName = 'TriggerDecisionProvider';

  evaluateTrigger(
    input: TriggerDecisionInput,
  ): TriggerDecisionResult {
    const delaySeconds = input.confirmationSeconds ?? 5;

    if (input.cancellationReceived === true) {
      return {
        shouldActivate: false,
        requiresConfirmation: false,
        isSilent: input.mode === TriggerMode.SILENT,
        delaySeconds: 0,
        reason: 'Emergency activation was cancelled by the user.',
        provider: this.providerName,
      };
    }

    if (input.triggerType === EmergencyTriggerType.SOS_BUTTON) {
      return {
        shouldActivate: true,
        requiresConfirmation: false,
        isSilent: input.mode === TriggerMode.SILENT,
        delaySeconds: 0,
        reason: 'SOS button activation is treated as an intentional emergency request.',
        provider: this.providerName,
      };
    }

    if (input.triggerType === EmergencyTriggerType.SILENT) {
      return {
        shouldActivate: true,
        requiresConfirmation: false,
        isSilent: true,
        delaySeconds: 0,
        reason: 'Silent trigger activated the emergency workflow immediately.',
        provider: this.providerName,
      };
    }

    if (input.triggerType === EmergencyTriggerType.VOICE) {
      if (input.voiceMatched !== true) {
        return {
          shouldActivate: false,
          requiresConfirmation: false,
          isSilent: input.mode === TriggerMode.SILENT,
          delaySeconds: 0,
          reason: 'The detected voice phrase did not match an active trigger phrase.',
          provider: this.providerName,
        };
      }

      if (input.mode === TriggerMode.IMMEDIATE) {
        return {
          shouldActivate: true,
          requiresConfirmation: false,
          isSilent: false,
          delaySeconds: 0,
          reason: 'Matched voice trigger activated immediate mode.',
          provider: this.providerName,
        };
      }

      if (input.mode === TriggerMode.SILENT) {
        return {
          shouldActivate: true,
          requiresConfirmation: false,
          isSilent: true,
          delaySeconds: 0,
          reason: 'Matched voice trigger activated silent mode.',
          provider: this.providerName,
        };
      }

      if (input.userConfirmed === true) {
        return {
          shouldActivate: true,
          requiresConfirmation: false,
          isSilent: false,
          delaySeconds: 0,
          reason: 'The user confirmed the voice-triggered emergency.',
          provider: this.providerName,
        };
      }

      return {
        shouldActivate: false,
        requiresConfirmation: true,
        isSilent: false,
        delaySeconds,
        reason: 'The voice trigger matched and is awaiting confirmation or timeout.',
        provider: this.providerName,
      };
    }

    if (
      input.triggerType === EmergencyTriggerType.SAFETY_CHECK ||
      input.triggerType === EmergencyTriggerType.TRUSTED_CONTACT
    ) {
      return {
        shouldActivate: input.userConfirmed === true,
        requiresConfirmation: input.userConfirmed !== true,
        isSilent: input.mode === TriggerMode.SILENT,
        delaySeconds,
        reason:
          input.userConfirmed === true
            ? 'The safety check or trusted-contact request was confirmed.'
            : 'The request requires confirmation before activation.',
        provider: this.providerName,
      };
    }

    return {
      shouldActivate: false,
      requiresConfirmation: false,
      isSilent: false,
      delaySeconds: 0,
      reason: 'The trigger did not meet activation requirements.',
      provider: this.providerName,
    };
  }
}