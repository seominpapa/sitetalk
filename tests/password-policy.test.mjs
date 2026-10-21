import test from 'node:test';
import assert from 'node:assert/strict';
import { validRegistrationPassword } from '../packages/shared/password-policy.ts';

test('registration passwords require eight characters, a digit and punctuation or a symbol', () => {
  for (const password of ['abcdef1!', '1234567!', '가나다라마바1!', 'abc1234-', 'abc1234_', 'abc1234$', 'abcd 1!x', 'abcdef1😀']) {
    assert.equal(validRegistrationPassword(password), true);
  }
  for (const password of ['', 'Abc1!xy', '12345678', 'abcdefg!', 'abcd1234', 'abcd123 ', '가나다라마바12']) {
    assert.equal(validRegistrationPassword(password), false);
  }
});
