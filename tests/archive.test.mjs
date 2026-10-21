import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveKey, buildMarkdown, parseSummary, summarizeArchive } from '../apps/worker/src/archive.ts';

const data = {
  room: { id: 'room-1', title: 'A/구간 협의', purpose: '변위 확인', project: '공항', work_category: '가시설', location: 'A구간', type: '안전', closed_at: Date.parse('2026-09-13T16:00:00Z') },
  participants: [{ name: '김대리' }],
  messages: [{ id: 'm1', seq: 1, user_name: '김대리', created_at: Date.parse('2026-09-13T04:42:00Z'), content: '원문\n```\n# 유지\n<script>alert(1)</script>', type: 'text' }],
  attachments: [{ id: 'a1', filename: '도면[1].pdf', message_id: 'm1' }],
  closure: { conclusion: '작업 중지', owner_name: '김대리', due_date: '2026-09-15', note: '다시 측정', closed_at: Date.parse('2026-09-13T16:00:00Z') },
};
const summary = { summary: '변위 확인 후 중지', decisions: ['작업 중지'], actions: ['김대리: 계측'], keywords: ['안전'] };

test('archive preserves exact original contents in safe code fences, closure, links and Seoul date', () => {
  const markdown = buildMarkdown(data, summary);
  assert.ok(markdown.includes(data.messages[0].content));
  assert.ok(markdown.includes('````text\n' + data.messages[0].content + '\n````'));
  assert.ok(markdown.includes('2026-09-14'));
  assert.ok(markdown.includes('13:42'));
  assert.ok(markdown.includes('2026-09-15'));
  assert.ok(markdown.includes('/api/attachments/a1'));
  assert.equal(archiveKey(data.room), 'site-talk-archive/2026/09/14/A_구간_협의--room-1.md');
});

test('site archive links approved staff to original transcript and site-shared attachments, preserving legacy links', () => {
  const markdown = buildMarkdown({ ...data, room: { ...data.room, site_id: 'site-1' } }, summary);
  assert.ok(markdown.includes('[대화 원문 열람](/summaries/room-1/original)'));
  assert.ok(markdown.includes('/api/summaries/room-1/attachments/a1'));
  assert.equal(markdown.includes('대화방 접근 권한이 필요합니다'), false);
  assert.ok(buildMarkdown(data, summary).includes('/api/attachments/a1'));
});

test('invalid, refused and incomplete AI outputs fail instead of marking a fake summary', () => {
  assert.deepEqual(parseSummary({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(summary) }] }] }), summary);
  for (const value of [{ status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"summary":"x"}' }] }] }]) assert.throws(() => parseSummary(value));
});

test('single invalid oversized message fails without dropping original data or issuing paid fetch', async () => {
  const long = { ...data, messages: [{ ...data.messages[0], content: 'a'.repeat(250_001) }] };
  await assert.rejects(summarizeArchive({ OPENAI_API_KEY: 'test' }, long), /too large/i);
});

test('GPT-6 catalog models use the existing Responses structured-output request', async t => {
  for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']) {
    const upstream = t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(init.body);
      assert.equal(body.model, model);
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, 'json_schema');
      assert.equal(body.text.format.strict, true);
      assert.equal('temperature' in body, false);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(summary) }] }] });
    });
    assert.deepEqual(await summarizeArchive({ OPENAI_API_KEY: 'test', OPENAI_MODEL: model }, data), summary);
    assert.equal(upstream.mock.callCount(), 1);
    upstream.mock.restore();
  }
});

test('long rooms summarize every message and attachment in bounded requests, preserve originals and label merged parts', async t => {
  const messages = Array.from({ length: 90 }, (_, index) => ({ ...data.messages[0], id: `m${index}`, seq: index + 1, content: `${index}:` + '기록"\n\\'.repeat(1700) }));
  const attachments = messages.map(message => ({ id: `a-${message.id}`, filename: `${message.id}.pdf`, message_id: message.id }));
  const long = { ...data, messages, attachments };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    const request = JSON.parse(init.body);
    assert.ok(init.body.length <= 250_000);
    assert.ok(request.input.length <= 250_000);
    const input = JSON.parse(request.input);
    assert.deepEqual(input.room, data.room);
    assert.deepEqual(input.closure, data.closure);
    requests.push(input);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...summary, summary: `요약 ${requests.length}` }) }] }] });
  });
  const result = await summarizeArchive({ OPENAI_API_KEY: 'test' }, long);
  assert.ok(requests.length > 1);
  assert.deepEqual(requests.flatMap(request => request.messages), messages);
  assert.deepEqual(requests.flatMap(request => request.attachments), attachments);
  assert.ok(result.summary.includes(`구간 1/${requests.length}`));
  assert.ok(result.summary.includes(`요약 ${requests.length}`));
  assert.deepEqual(result.decisions, summary.decisions);
  const markdown = buildMarkdown(long, result);
  for (const message of messages) assert.ok(markdown.includes(message.content));
  for (const attachment of attachments) assert.ok(markdown.includes(`/api/attachments/${attachment.id}`));
});

test('processing deadline prevents another paid request instead of returning a partial summary', async t => {
  const long = { ...data, messages: Array.from({ length: 60 }, (_, index) => ({ ...data.messages[0], id: `m${index}`, content: '가'.repeat(9500) })) };
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    now += 480_000;
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(summary) }] }] });
  });
  await assert.rejects(summarizeArchive({ OPENAI_API_KEY: 'test' }, long), /time budget exceeded/);
  assert.equal(fetch.mock.callCount(), 1);
});
