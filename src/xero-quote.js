import { moneyCents, withGstCents } from './work-finance.js';

export function parseXeroQuoteTotals(text) {
  const amount = String.raw`(?:NZD\s*)?\$?\s*([0-9][0-9,]*\.[0-9]{2})(?![0-9%])`;
  const subtotal = text.match(new RegExp(String.raw`(?:Subtotal|Total\s*(?:excl\.?|excluding)\s*GST)\s*:?\s*${amount}`, 'i'));
  const total = text.match(new RegExp(String.raw`(?:Total\s*(?:incl\.?|including)\s*GST|Total\s*NZD|Amount\s*Due)\s*:?\s*${amount}`, 'i'));
  let net = subtotal ? moneyCents(subtotal[1].replaceAll(',', '')) : null;
  let gross = total ? moneyCents(total[1].replaceAll(',', '')) : null;
  if (net !== null && gross === null) gross = withGstCents(net);
  if (net === null && gross !== null) net = Math.round(gross * 100 / 115);
  return {
    amountExclGst: net === null ? '' : (net / 100).toFixed(2),
    amountIncGst: gross === null ? '' : (gross / 100).toFixed(2),
  };
}
