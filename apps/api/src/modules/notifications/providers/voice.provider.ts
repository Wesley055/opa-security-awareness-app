import {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from './notification-provider.interface';

export class VoiceProvider implements NotificationProvider {
  readonly providerName = 'Voice';

  async send(
    request: NotificationRequest,
  ): Promise<NotificationResponse> {
    // ADR-015 SECTION 6b: A PROVIDER THAT CANNOT DELIVER MUST RETURN
    // FAILURE. This channel is not implemented - no API is called and
    // no message leaves this process.
    //
    // Until 9 August 2026 this returned success:true with a fabricated
    // messageId. The dispatch worker records delivery outcome from that
    // value, so the production database held records of successful
    // Voice deliveries that never happened, and the hash-chained
    // timeline faithfully preserved the false claim. The integrity
    // machinery worked perfectly on data that was not true.
    //
    // NO messageId IS RETURNED. An invented identifier for a message
    // that does not exist is as untrue as the success flag was.
    console.warn(
      `[VoiceProvider] NOT IMPLEMENTED - nothing sent to ${request.recipient}`,
    );

    return {
      success: false,
      provider: this.providerName,
      error: 'Voice provider not implemented',
    };
  }
}