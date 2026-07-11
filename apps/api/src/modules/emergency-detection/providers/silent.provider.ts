import { Injectable } from '@nestjs/common';
import { TriggerMode } from '../dto/trigger-request.dto';

export interface SilentModeInput {
  mode: TriggerMode;
  silentProfileEnabled?: boolean;
  screenLocked?: boolean;
  concealActivation?: boolean;
}

export interface SilentModeResult {
  isSilent: boolean;
  concealActivation: boolean;
  suppressSound: boolean;
  suppressVisibleAlert: boolean;
  continueWhenLocked: boolean;
  reason: string;
  provider: string;
}

@Injectable()
export class SilentProvider {
  readonly providerName = 'SilentActivationProvider';

  evaluate(input: SilentModeInput): SilentModeResult {
    const isSilent =
      input.mode === TriggerMode.SILENT ||
      input.silentProfileEnabled === true;

    if (!isSilent) {
      return {
        isSilent: false,
        concealActivation: false,
        suppressSound: false,
        suppressVisibleAlert: false,
        continueWhenLocked: false,
        reason: 'Silent mode is not enabled.',
        provider: this.providerName,
      };
    }

    return {
      isSilent: true,
      concealActivation: input.concealActivation ?? true,
      suppressSound: true,
      suppressVisibleAlert: true,
      continueWhenLocked: input.screenLocked ?? true,
      reason: 'Silent activation settings were applied.',
      provider: this.providerName,
    };
  }
}