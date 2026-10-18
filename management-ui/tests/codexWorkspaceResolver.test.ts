import { describe, expect, test } from 'bun:test';
import { resolveCodexChatgptAccountId } from '@/utils/quota/resolvers';

const idToken = (accountId: string) =>
  `e30.${Buffer.from(JSON.stringify({ chatgpt_account_id: accountId })).toString('base64url')}.sig`;

describe('Codex workspace resolution', () => {
  test('prefers the workspace the server reports over the ID token claim', () => {
    // The server names the workspace its quota reads act for; reset-credit
    // redemption must use the same one.
    expect(
      resolveCodexChatgptAccountId({
        name: 'codex.json',
        chatgpt_account_id: 'acct-b',
        id_token: { chatgpt_account_id: 'acct-a' },
      })
    ).toBe('acct-b');
    expect(
      resolveCodexChatgptAccountId({
        name: 'codex.json',
        metadata: { id_token: idToken('acct-a') },
      })
    ).toBe('acct-a');
  });
});
