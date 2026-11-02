import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarClient } from '../calendar-client.js';

test('calendar adapter uses narrow PATCH with If-Match and no guests or full-event replacement', async () => {
  let request;
  const client = calendarClient({
    calendarId: 'TEST@group.calendar.google.com',
    getAccessToken: async () => 'TEST_NOT_A_REAL_TOKEN',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: 'event123' }) };
    }
  });
  const body = { start: { date: '2026-11-05' }, end: { date: '2026-11-11' } };
  await client.patch('event123', body, '"etag1"');
  assert.equal(request.options.method, 'PATCH');
  assert.equal(request.options.headers['If-Match'], '"etag1"');
  assert.equal(request.options.headers.Authorization, 'Bearer TEST_NOT_A_REAL_TOKEN');
  assert.deepEqual(JSON.parse(request.options.body), body);
  assert.ok(request.url.includes('TEST%40group.calendar.google.com'));
});

test('404 is absent, 410 is deleted, and 403/412/429 propagate without response bodies', async () => {
  for (const status of [404, 410, 403, 412, 429]) {
    const client = calendarClient({
      calendarId: 'TEST', getAccessToken: async () => 'TEST',
      fetchImpl: async () => ({ ok: false, status })
    });
    if (status === 404) assert.equal(await client.get('id123'), null);
    else if (status === 410) assert.equal((await client.get('id123')).status, 'cancelled');
    else await assert.rejects(client.get('id123'), { status, message: `Calendar request failed (${status})` });
  }
});
