import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * THE SINGLE CANONICAL PHONE RULE FOR OPA.
 *
 * Every phone number entering the system passes through here, and everything
 * downstream - storage, uniqueness, lookup, SMS delivery - consumes E.164.
 *
 * Before 9 August 2026 there was no such rule. Registration validated
 * Nigeria-only, emergency contacts validated internationally, both services
 * wrote the raw submitted string, and SmsProvider guessed at DELIVERY time
 * that anything without a country code was Nigerian. A US number entered as
 * 4694791451 became +2344694791451 on its way to the carrier.
 *
 * NIGERIA IS A DEFAULT, NOT A RESTRICTION. A number carrying its own country
 * code is parsed as that country, whatever it is. defaultRegion applies ONLY
 * to input with no international prefix, and exists so an existing Nigerian
 * user can keep typing 08024662124. When the mobile app gains a country
 * picker it passes the selected region here and the default stops mattering.
 */
export const DEFAULT_PHONE_REGION: CountryCode = 'NG';

/**
 * Normalises to E.164, or throws. Use on WRITE paths, where an unparseable
 * number is a client error worth surfacing.
 *
 * Bare '234...' is handled explicitly: libphonenumber reads it as a national
 * number under the default region rather than as a country code, so it would
 * otherwise fail. Only applied when the default region IS Nigeria.
 */
export function toE164(
  input: string,
  defaultRegion: CountryCode = DEFAULT_PHONE_REGION,
): string {
  const normalised = normaliseOrNull(input, defaultRegion);

  if (normalised === null) {
    throw new BadRequestException(
      'Enter a valid phone number, including the country code for numbers outside Nigeria.',
    );
  }

  return normalised;
}

/**
 * The parse itself. Separated from toE164 only so the throw sits in one
 * place; there is deliberately NO exported non-throwing variant.
 *
 * An earlier draft exported one so UsersService.findByPhone could normalise
 * its own argument. That would have created a SECOND normalisation
 * authority: findByPhone has no region argument, so it would always assume
 * Nigeria, and once the mobile country picker sends region=US with a bare
 * 4694791451, the write path and the lookup path would disagree about the
 * same input. CALLERS NORMALISE. This module is the only thing that decides
 * what a number means, and it decides it once, at the boundary.
 */
function normaliseOrNull(
  input: string,
  defaultRegion: CountryCode,
): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }

  // A bare country code with no '+' - '2348024662124'. libphonenumber would
  // read this as a national number under defaultRegion and reject it, so the
  // '+' is restored first. Guarded to Nigeria: doing this for every region
  // would misread national numbers that happen to start with 234.
  const candidate =
    defaultRegion === 'NG' && /^234\d{7,}$/.test(trimmed.replace(/[^\d]/g, ''))
      ? '+' + trimmed.replace(/[^\d]/g, '')
      : trimmed;

  const parsed = parsePhoneNumberFromString(candidate, defaultRegion);

  if (!parsed || !parsed.isValid()) {
    return null;
  }

  return parsed.number;
}
