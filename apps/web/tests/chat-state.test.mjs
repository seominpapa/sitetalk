import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileIdentity, mergeMessages, recoverMessages } from '../src/chat-state.ts';

test('reconnection recovers every message across more than two missed pages', async () => {
  const all = Array.from({ length: 185 }, (_, index) => ({ id: String(index + 1), seq: index + 1 }));
  const cursors = [];
  const recovered = await recoverMessages(async (before = Infinity) => {
    cursors.push(before);
    return all.filter((message) => message.seq < before).slice(-50);
  }, 20);
  assert.deepEqual(mergeMessages(all.slice(0, 20), recovered), all);
  assert.deepEqual(cursors, [Infinity, 136, 86, 36]);
});

test('first load only loads one page and overlapping messages remain unique', async () => {
  let calls = 0;
  const messages = [{ id: 'a', seq: 1 }, { id: 'b', seq: 2 }];
  assert.deepEqual(await recoverMessages(async () => { calls++; return messages; }, 0), messages);
  assert.equal(calls, 1);
  assert.deepEqual(mergeMessages(messages, [{ id: 'b', seq: 2 }, { id: 'c', seq: 3 }]).map((message) => message.id), ['a', 'b', 'c']);
});

test('a reselected upload has the same retry identity; changed content differs', async () => {
  const first = new File(['same bytes'], 'plan.pdf', { type: 'application/pdf', lastModified: 1 });
  const retry = new File(['same bytes'], 'plan.pdf', { type: 'application/pdf', lastModified: 2 });
  const changed = new File(['new bytes!'], 'plan.pdf', { type: 'application/pdf', lastModified: 1 });
  assert.equal(await fileIdentity(first), await fileIdentity(retry));
  assert.notEqual(await fileIdentity(first), await fileIdentity(changed));
});
