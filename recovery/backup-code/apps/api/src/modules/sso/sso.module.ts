import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { SsoSecrets } from './sso-secrets';
import { SsoNetwork } from './sso-network';
import { OidcProtocolVerifier } from './oidc-protocol-verifier';
import { SamlProtocolVerifier } from './saml-protocol-verifier';
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SsoController],
  providers: [
    SsoService,
    SsoSecrets,
    SsoNetwork,
    OidcProtocolVerifier,
    SamlProtocolVerifier,
  ],
})
export class SsoModule {}
