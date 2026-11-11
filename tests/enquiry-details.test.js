import test from 'node:test';
import assert from 'node:assert/strict';
import { enquiryAddress, enquiryMessages } from '../src/enquiry-details.js';

test('keeps the full submitted address, including line breaks', () => {
  assert.equal(enquiryAddress({ address: '10 Example St\nKarori, Wellington' }), '10 Example St\nKarori, Wellington');
  assert.equal(enquiryAddress({ address: 'karori' }), 'karori');
});

test('formats structured address fields instead of hiding them behind an old suburb', () => {
  assert.equal(enquiryAddress({ address: 'Karori', addressDetails: {
    unit: '2', street: '10 Example St', neighborhood: 'Karori', city: 'Wellington', postalCode: '6012'
  } }), 'Unit 2, 10 Example St, Karori, Wellington, 6012');
  assert.equal(enquiryAddress({ address: 'Karori', addressDetails: { street: '' } }), 'Karori');
  assert.equal(enquiryAddress({}), '');
});

test('shows original and legacy message fields without truncation or HTML interpretation', () => {
  const text = 'Cracks on the wall.\nPlease inspect.\n<script>not markup</script>' + 'x'.repeat(10000);
  assert.equal(enquiryMessages({ message: text })[0].text, text);
  assert.equal(enquiryMessages({ message: '  ', enquiryMessage: 'Legacy enquiry' })[0].text, 'Legacy enquiry');
  assert.equal(enquiryMessages({ websiteMessage: 'Website enquiry' })[0].text, 'Website enquiry');
});

test('loads incoming history when original fields are missing, excluding team notes', () => {
  const history = [
    { id: 'incoming', direction: 'incoming', text: 'Saved form message' },
    { id: 'note', type: 'note', text: 'Private team note' }
  ];
  assert.deepEqual(enquiryMessages({}, history).map(row => row.text), ['Saved form message']);
});

test('deduplicates original and stored incoming messages and ignores malformed values', () => {
  assert.equal(enquiryMessages({ message: 'Original' }, [
    { id: 'duplicate', direction: 'incoming', text: 'Original' },
    { id: 'duplicate-whitespace', direction: 'incoming', text: ' Original ' },
    { id: 'empty', direction: 'incoming', text: ' ' },
    { id: 'object', direction: 'incoming', text: {} },
    { id: 'second', direction: 'incoming', text: 'Another enquiry' }
  ]).length, 2);
  assert.deepEqual(enquiryMessages({ message: {} }), []);
});
