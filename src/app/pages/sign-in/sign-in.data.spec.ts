import { describe, expect, it } from 'vitest';
import { uk } from '../../i18n/uk';
import { signInErrorMessage } from './sign-in.data';

describe('signInErrorMessage', () => {
  it('различает лимит, неверный код и неверный адрес', () => {
    expect(signInErrorMessage({ status: 429, code: 'over_email_send_rate_limit' })).toBe(uk.signIn.errorRateLimit);
    expect(signInErrorMessage({ status: 403, code: 'otp_expired' })).toBe(uk.signIn.errorBadCode);
    expect(signInErrorMessage({ status: 400, code: 'email_address_invalid' })).toBe(uk.signIn.errorBadEmail);
    expect(signInErrorMessage(new TypeError('Failed to fetch'))).toBe(uk.signIn.errorGeneric);
  });
});
