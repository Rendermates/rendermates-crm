export function calendarClient({ calendarId, getAccessToken, fetchImpl = fetch }) {
  const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  async function request(method, eventId = '', body, etag) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${root}${eventId ? `/${encodeURIComponent(eventId)}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(etag ? { 'If-Match': etag } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000)
    });
    if (method === 'GET' && response.status === 404) return null;
    if (method === 'GET' && response.status === 410) return { id: eventId, status: 'cancelled' };
    if (!response.ok) {
      // Never log upstream bodies, tokens, or customer event contents.
      const error = new Error(`Calendar request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  return {
    get: id => request('GET', id),
    create: event => request('POST', '', event),
    patch: (id, body, etag) => request('PATCH', id, body, etag)
  };
}
