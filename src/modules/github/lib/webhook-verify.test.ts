import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './webhook-verify';

describe('verifyWebhookSignature', () => {
  it('accepts a valid GitHub HMAC signature', () => {
    const body = '{"event":"push"}';
    const secret = 'test-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects invalid, missing, and malformed signatures', () => {
    expect(verifyWebhookSignature('body', null, 'secret')).toBe(false);
    expect(verifyWebhookSignature('body', 'sha256=invalid', 'secret')).toBe(false);
    expect(verifyWebhookSignature('body', 'sha1=invalid', 'secret')).toBe(false);
  });
});
