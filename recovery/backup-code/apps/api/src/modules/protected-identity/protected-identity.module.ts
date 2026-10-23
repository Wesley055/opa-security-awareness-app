import { ProtectedSnapshotsService } from "./protected-snapshots.service";
import { Module, ServiceUnavailableException } from "@nestjs/common";
import { IdentityCrypto, LocalIdentityCrypto } from "./identity-crypto";
import { ProtectedIdentityController } from "./protected-identity.controller";
import { ProtectedIdentityService } from "./protected-identity.service";

class UnconfiguredCrypto extends IdentityCrypto {
  async seal(): Promise<never> {
    throw new ServiceUnavailableException(
      "Protected identity operation unavailable.",
    );
  }
  async open(): Promise<never> {
    throw new ServiceUnavailableException(
      "Protected identity operation unavailable.",
    );
  }
  async lookup(): Promise<never> {
    throw new ServiceUnavailableException(
      "Protected identity operation unavailable.",
    );
  }
}

export function configuredIdentityCrypto(): IdentityCrypto {
  if (process.env.NODE_ENV === "production" && process.env.PII_CRYPTO_ADAPTER !== "local")
    throw new Error("Protected identity crypto configuration is required in production.");
  // Explicit opt-in. Existing emergency delivery does not depend on hypothetical key infrastructure.
  if (process.env.PII_CRYPTO_ADAPTER !== "local") {
    if (process.env.PII_CRYPTO_ADAPTER)
      throw new Error("Unsupported protected identity crypto adapter.");
    return new UnconfiguredCrypto();
  }
  try {
    const values = JSON.parse(
      process.env.PII_ENCRYPTION_KEYS_JSON ?? "",
    ) as Record<string, string>;
    const decode = (value: string) => {
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value)
        throw new Error();
      return key;
    };
    return new LocalIdentityCrypto(
      new Map(
        Object.entries(values).map(([version, value]) => [
          version,
          decode(value),
        ]),
      ),
      process.env.PII_ENCRYPTION_KEY_VERSION ?? "",
      decode(process.env.PII_LOOKUP_KEY ?? ""),
      process.env.PII_LOOKUP_KEY_VERSION ?? "",
    );
  } catch {
    throw new Error("Invalid protected identity key configuration.");
  }
}

@Module({
  controllers: [ProtectedIdentityController],
  providers: [
    ProtectedSnapshotsService,
    ProtectedIdentityService,
    { provide: IdentityCrypto, useFactory: configuredIdentityCrypto },
  ],
  exports: [ProtectedIdentityService, ProtectedSnapshotsService],
})
export class ProtectedIdentityModule {}
