import { NotificationDispatchWorker } from "../notifications/notification-dispatch.worker";
import { InvitationDeliveryWorker } from "../admin-provisioning/invitation-delivery.worker";
import { Logger } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { Response } from "express";
import { GlobalExceptionFilter } from "../../shared/filters/global-exception.filter";
import { CorrelationIdMiddleware } from "../../shared/middleware/correlation-id.middleware";
import type { CorrelatedRequest } from "../../shared/middleware/correlation-id.middleware";
import {
  RequestLoggingMiddleware,
  redactSensitivePath,
} from "../../shared/middleware/request-logging.middleware";
import { SmsProvider } from "../notifications/providers/sms.provider";
import * as outboundEnvironment from "../notifications/outbound-environment";
import { EmailProvider } from "../notifications/providers/email.provider";
import { PushProvider } from "../notifications/providers/push.provider";
import { VoiceProvider } from "../notifications/providers/voice.provider";
import { WhatsAppProvider } from "../notifications/providers/whatsapp.provider";

const pii = "secret.person@example.test";
describe("ordinary logging PII boundaries", () => {
  it("drops identifier query strings", () => {
    expect(redactSensitivePath(`/admin/residents?email=${pii}`)).toBe(
      "/admin/residents",
    );
  });
  it("logs route templates, not paths, user agents, IPs or query values", () => {
    const spy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const req = {
      originalUrl: `/admin/${pii}?phone=+14155552671`,
      method: "GET",
      ip: "192.0.2.1",
      get: () => pii,
      route: { path: "/admin/:id" },
      correlationId: "00000000-0000-4000-8000-000000000001",
    } as unknown as CorrelatedRequest;
    const response = {
      on: (_name: string, fn: () => void) => fn(),
      statusCode: 200,
    } as unknown as Response;
    try {
      new RequestLoggingMiddleware().use(req, response, () => undefined);
      const log = JSON.stringify(spy.mock.calls);
      expect(log).not.toContain(pii);
      expect(log).not.toContain("192.0.2.1");
      expect(log).toContain("/admin/:id");
    } finally {
      spy.mockRestore();
    }
  });
  it("does not log arbitrary exception messages, stacks or unknown paths", () => {
    const spy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const res = { status: () => res, json: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: `/unknown/${pii}`, method: "GET" }),
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;
    try {
      new GlobalExceptionFilter().catch(
        new Error(`Database parameters: ${pii}`),
        host,
      );
      expect(JSON.stringify(spy.mock.calls)).not.toContain(pii);
      expect(spy.mock.calls[0]).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
  it("replaces identifier-shaped incoming correlation IDs", () => {
    const req = { header: () => pii } as unknown as CorrelatedRequest;
    const res = { setHeader: jest.fn() } as unknown as Response;
    new CorrelationIdMiddleware().use(req, res, () => undefined);
    expect(req.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.correlationId).not.toBe(pii);
  });
  it("does not log recipients in unavailable provider paths", async () => {
    const previous = {
      sms: process.env.AFRICASTALKING_API_KEY,
      email: process.env.RESEND_API_KEY,
    };
    delete process.env.AFRICASTALKING_API_KEY;
    delete process.env.RESEND_API_KEY;
    const spies = [
      jest.spyOn(console, "warn").mockImplementation(() => undefined),
      jest.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    try {
      for (const provider of [
        new SmsProvider(),
        new EmailProvider(),
        new PushProvider(),
        new VoiceProvider(),
        new WhatsAppProvider(),
      ]) {
        expect(
          (await provider.send({ recipient: pii, message: "secret-content" }))
            .success,
        ).toBe(false);
      }
      expect(
        JSON.stringify(spies.flatMap((spy) => spy.mock.calls)),
      ).not.toContain(pii);
      expect(
        JSON.stringify(spies.flatMap((spy) => spy.mock.calls)),
      ).not.toContain("secret-content");
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      if (previous.sms === undefined) delete process.env.AFRICASTALKING_API_KEY;
      else process.env.AFRICASTALKING_API_KEY = previous.sms;
      if (previous.email === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.email;
    }
  });

  it("omits raw failures from both worker tick logs", async () => {
    const spy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const failed = jest
      .fn()
      .mockRejectedValue(
        new Error("private@example.test Authorization=secret cookie=secret"),
      );
    try {
      await new NotificationDispatchWorker(
        { incidentNotification: { findFirst: failed } } as never,
        {} as never,
      ).tick();
      await new InvitationDeliveryWorker(
        { accountInvitationDelivery: { updateMany: failed } } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ).tick();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(
        "private@example.test",
      );
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    } finally {
      spy.mockRestore();
    }
  });
  it("keeps the real notification policy fail-closed before transport", async () => {
    const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not send"));
    try {
      await expect(new EmailProvider().send({ recipient: pii, message: "secret" }))
        .resolves.toMatchObject({ success: false, failureCategory: "REJECTED", retryable: false });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("sanitizes email transport exceptions without returning provider secrets", async () => {
    const previousKey = process.env.RESEND_API_KEY,
      previousFrom = process.env.RESEND_FROM_ADDRESS;
    process.env.RESEND_API_KEY = "test-only";
    process.env.RESEND_FROM_ADDRESS = "test@example.test";
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("private@example.test Bearer secret"));
    // Exercise the mocked transport error, independently of the fail-closed send policy.
    const gate = jest.spyOn(outboundEnvironment, "outboundDenial").mockResolvedValue(null);
    try {
      expect(
        await new EmailProvider().send({ recipient: pii, message: "secret" }),
      ).toEqual({
        success: false,
        provider: "Email",
        error: "Email outcome uncertain",
        uncertain: true,
        failureCategory: "NETWORK",
        retryable: false,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      gate.mockRestore();
      fetch.mockRestore();
      if (previousKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousKey;
      if (previousFrom === undefined) delete process.env.RESEND_FROM_ADDRESS;
      else process.env.RESEND_FROM_ADDRESS = previousFrom;
    }
  });
});
