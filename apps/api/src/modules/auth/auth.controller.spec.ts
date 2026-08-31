import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';

describe('AuthController activation throttling', () => {
  it('attaches ThrottlerGuard only to the activation handler', () => {
    const controllerGuards =
      Reflect.getMetadata(GUARDS_METADATA, AuthController) ?? [];

    const activationGuards =
      Reflect.getMetadata(
        GUARDS_METADATA,
        AuthController.prototype.activate,
      ) ?? [];

    expect(controllerGuards).not.toContain(ThrottlerGuard);
    expect(activationGuards).toContain(ThrottlerGuard);
  });

  it('limits activation to five attempts per 60 seconds', () => {
    const handler = AuthController.prototype.activate;

    expect(
      Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler),
    ).toBe(5);

    expect(
      Reflect.getMetadata(`${THROTTLER_TTL}default`, handler),
    ).toBe(60000);
  });
});