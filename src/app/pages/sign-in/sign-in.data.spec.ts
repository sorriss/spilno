import { describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import { signInErrorMessage } from './sign-in.data';

describe('signInErrorMessage', () => {
  it('различает лимит, неверный код и неверный адрес', () => {
    expect(signInErrorMessage({ status: 429, code: 'over_email_send_rate_limit' })).toBe(i18n.signIn.errorRateLimit);
    expect(signInErrorMessage({ status: 403, code: 'otp_expired' })).toBe(i18n.signIn.errorBadCode);
    expect(signInErrorMessage({ status: 400, code: 'email_address_invalid' })).toBe(i18n.signIn.errorBadEmail);
    expect(signInErrorMessage(new TypeError('Failed to fetch'))).toBe(i18n.signIn.errorGeneric);
  });
});
