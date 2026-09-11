import type {
  LoginTransaction,
  ProtocolVerifier,
  SsoCompletionPort,
  SsoConfiguration,
} from './sso.contracts';
import {
  replayKey,
  SsoDenied,
  validateAssertion,
  validateCallbackBinding,
} from './sso.policy';

/** Shared verification coordinator for both login and locally reauthenticated linking. */
export async function verifySsoCallback(
  config: SsoConfiguration,
  transaction: LoginTransaction,
  input: {
    organizationId: string;
    state: string;
    browserBinding: string;
    rawResponse: unknown;
  },
  verifier: ProtocolVerifier,
  clock: () => number = Date.now,
) {
  try {
    validateCallbackBinding(config, transaction, input, clock());
    const assertion = await verifier.verify(
      config,
      transaction,
      input.rawResponse,
    );
    const now = clock();
    validateCallbackBinding(config, transaction, input, now);
    return {
      assertion,
      identity: validateAssertion(config, transaction, assertion, now),
    };
  } catch {
    throw new SsoDenied();
  }
}

/**
 * Internal login coordinator. All inputs except the response/state/browser
 * binding come from trusted storage. Not registered in AuthModule.
 * Completion must enforce the atomic contract in sso.contracts.ts.
 */
export async function completeSsoLogin<Session>(
  config: SsoConfiguration,
  transaction: LoginTransaction,
  input: {
    organizationId: string;
    state: string;
    browserBinding: string;
    rawResponse: unknown;
    correlationId: string;
  },
  verifier: ProtocolVerifier,
  completion: SsoCompletionPort<Session>,
  clock: () => number = Date.now,
): Promise<Session> {
  try {
    if (transaction.purpose !== 'login') throw new SsoDenied();
    const { assertion, identity } = await verifySsoCallback(
      config,
      transaction,
      input,
      verifier,
      clock,
    );
    return await completion.complete({
      transactionId: transaction.id,
      expectedConfigurationRevision: config.revision,
      identity,
      replayKey: replayKey(assertion),
      replayExpiresAt: assertion.expiresAt + 60_000,
      correlationId: input.correlationId,
    });
  } catch {
    // Includes provider, repository and signing errors; never preserve cause.
    // HTTP integration must append a fixed AUTHENTICATION_FAILED audit event.
    throw new SsoDenied();
  }
}
