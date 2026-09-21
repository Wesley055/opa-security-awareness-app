import type { DeliveryDiagnostic, DeliveryStage } from "../delivery-diagnostics";
import type { DeliveryFailureCategory } from "@prisma/client";
export interface NotificationRequest {
  recipient: string;
  subject?: string;
  message: string;
}

export interface NotificationResponse {
  success: boolean;
  stage?: DeliveryStage;
  diagnostic?: DeliveryDiagnostic;
  provider: string;
  messageId?: string;
  error?: string;
  failureCategory?: DeliveryFailureCategory;
  retryable?: boolean;
  uncertain?: boolean;
}

export interface NotificationProvider {
  readonly providerName: string;

  send(request: NotificationRequest): Promise<NotificationResponse>;
}
