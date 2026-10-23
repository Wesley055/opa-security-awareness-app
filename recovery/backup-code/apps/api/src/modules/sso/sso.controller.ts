import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { SsoService } from './sso.service';
import { SsoDenied } from './sso.policy';
const bounded = z.string().min(1).max(2048);
const configuration = z
  .object({
    providerType: z.enum(['OIDC', 'SAML2']),
    issuer: bounded,
    audience: bounded,
    enabled: z.boolean(),
    expectedRevision: z.number().int().positive().optional(),
    clientSecret: z.string().min(1).max(8192).optional(),
    trust: z
      .object({
        discoveryUrl: bounded.optional(),
        authorizationEndpoint: bounded,
        tokenEndpoint: bounded.optional(),
        jwksUri: bounded.optional(),
        certificates: z
          .array(z.string().min(1).max(8192))
          .min(1)
          .max(3)
          .optional(),
      })
      .strict(),
  })
  .strict();
const callback = z
  .object({
    transactionId: z.string().uuid(),
    state: z.string().min(1).max(2048),
    browserBinding: z.string().min(1).max(2048),
    rawResponse: z.string().min(1).max(90000),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SsoDenied();
  return result.data;
}
type AuthRequest = Request & { user: JwtPayload };
function actor(request: AuthRequest) {
  const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) throw new SsoDenied();
  return {
    id: request.user.sub,
    credentialVersion: request.user.credentialVersion ?? 0,
    token,
  };
}
@Controller('sso')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class SsoController {
  constructor(private readonly sso: SsoService) {}
  @Header('Cache-Control', 'no-store')
  @Post('link/finish')
  @UseGuards(JwtAuthGuard)
  finishLink(@Req() request: AuthRequest, @Body() body: unknown) {
    const input = parse(
      z
        .object({
          transactionId: z.string().uuid(),
          browserBinding: z.string().min(1).max(2048),
        })
        .strict(),
      body,
    );
    return this.sso.finishLink(
      actor(request),
      input.transactionId,
      input.browserBinding,
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('configurations/:id/initiate')
  initiate(@Param('id', ParseUUIDPipe) id: string) {
    return this.sso.initiate(id);
  }
  @Header('Cache-Control', 'no-store')
  @Post('callback')
  callback(@Body() body: unknown) {
    const input = parse(callback, body);
    return this.sso.callback(
      input.transactionId,
      input.state,
      input.browserBinding,
      input.rawResponse,
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('link/callback')
  @UseGuards(JwtAuthGuard)
  linkCallback(@Req() request: AuthRequest, @Body() body: unknown) {
    const input = parse(callback, body);
    return this.sso.callback(
      input.transactionId,
      input.state,
      input.browserBinding,
      input.rawResponse,
      actor(request),
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('configurations/:id/link')
  @UseGuards(JwtAuthGuard)
  link(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({ password: z.string().min(1).max(256) }).strict(),
      body,
    );
    return this.sso.initiate(id, actor(request), input.password);
  }
  @Header('Cache-Control', 'no-store')
  @Post('identities/:id/unlink')
  @UseGuards(JwtAuthGuard)
  unlink(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({ password: z.string().min(1).max(256) }).strict(),
      body,
    );
    return this.sso.unlink(actor(request), id, input.password);
  }
  @Header('Cache-Control', 'no-store')
  @Get('identities')
  @UseGuards(JwtAuthGuard)
  identities(@Req() request: AuthRequest) {
    return this.sso.identities(actor(request));
  }
  @Header('Cache-Control', 'no-store')
  @Get('facilities/:facilityId/configurations')
  @UseGuards(JwtAuthGuard)
  configurations(
    @Req() request: AuthRequest,
    @Param('facilityId', ParseUUIDPipe) facilityId: string,
  ) {
    return this.sso.list(actor(request), facilityId);
  }
  @Header('Cache-Control', 'no-store')
  @Get('facilities/:facilityId/audit')
  @UseGuards(JwtAuthGuard)
  audit(
    @Req() request: AuthRequest,
    @Param('facilityId', ParseUUIDPipe) facilityId: string,
  ) {
    return this.sso.audit(actor(request), facilityId);
  }
  @Header('Cache-Control', 'no-store')
  @Post('facilities/:facilityId/configurations')
  @UseGuards(JwtAuthGuard)
  create(
    @Req() request: AuthRequest,
    @Param('facilityId', ParseUUIDPipe) facilityId: string,
    @Body() body: unknown,
  ) {
    return this.sso.save(
      actor(request),
      facilityId,
      parse(configuration, body),
    );
  }
  @Header('Cache-Control', 'no-store')
  @Put('facilities/:facilityId/configurations/:id')
  @UseGuards(JwtAuthGuard)
  update(
    @Req() request: AuthRequest,
    @Param('facilityId', ParseUUIDPipe) facilityId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.sso.save(
      actor(request),
      facilityId,
      parse(configuration, body),
      id,
    );
  }
}
