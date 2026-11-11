const nonempty = value => typeof value === 'string' && value.trim() ? value : '';

export function enquiryAddress(job = {}) {
  const details = job.addressDetails || {};
  const structured = [details.unit && `Unit ${details.unit}`, details.street, details.neighborhood,
    details.city, details.region, details.postalCode, details.country].filter(nonempty).join(', ');
  return structured || nonempty(job.address);
}

export function enquiryMessages(job = {}, history = []) {
  const original = [job.message, job.enquiryMessage, job.websiteMessage].find(nonempty);
  const messages = original ? [{ id: 'original-enquiry', text: original, source: 'Original website enquiry' }] : [];
  const seen = new Set(messages.map(row => row.text.trim()));
  for (const row of history) {
    if (row.direction !== 'incoming' || !nonempty(row.text) || seen.has(row.text.trim())) continue;
    seen.add(row.text.trim());
    messages.push({ id: row.id, text: row.text, source: row.source || 'Saved incoming enquiry' });
  }
  return messages;
}
