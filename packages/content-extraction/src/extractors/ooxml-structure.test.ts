// DOCX and PPTX structure -- the defects found on the pilot SOPs, 2026-10-22.
//
// Every fixture is synthetic, built in memory from the XML shown beside it.
// Each case was a real loss of text or a real gluing of words:
//
//   * an empty self-closing `<w:p/>` read as an OPEN paragraph, which then
//     swallowed the next table (one pilot SOP lost half its text);
//   * an always-self-closing element (`w:commentRangeStart`, `c:chart`) passed
//     to stripElements removed EVERYTHING after it;
//   * a table cell's paragraphs were glued ("PurposeThis SOP explains");
//   * a `<w:br/>` became a space outside any `<w:t>`, which is never read, so
//     a code block's lines were glued ("storeGet-ChildItem").

import { describe, expect, it } from 'vitest';
import { zipOf } from '../../../testing/contracts/support/synthetic-xlsx.js';
import { extractDocx } from './docx.js';
import { extractPptx } from './pptx.js';
import { runText, stripElements, topLevelElements } from './ooxml.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body: string): Uint8Array =>
  zipOf({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
  });
const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const textOf = (bytes: Uint8Array): string =>
  extractDocx(bytes)
    .blocks.map((block) => block.text)
    .join('\n');

describe('topLevelElements', () => {
  it('treats a self-closing element as empty, not as an opening', () => {
    const elements = topLevelElements('<w:p w14:paraId="1" /><w:p><w:t>a</w:t></w:p>', ['w:p']);
    expect(elements.map((e) => e.body)).toEqual([null, '<w:t>a</w:t>']);
  });

  it('does not match a longer tag name that starts with the same letters', () => {
    expect(topLevelElements('<w:pPr/><w:pStyle w:val="x"/>', ['w:p'])).toEqual([]);
    expect(topLevelElements('<w:tab/><w:t>x</w:t>', ['w:t']).map((e) => e.body)).toEqual(['x']);
  });

  it('keeps a nested element inside its parent', () => {
    const xml = '<w:tbl><w:tr><w:tc><w:tbl><w:tr/></w:tbl></w:tc></w:tr></w:tbl><w:p/>';
    const elements = topLevelElements(xml, ['w:tbl', 'w:p']);
    expect(elements.map((e) => e.tag)).toEqual(['w:tbl', 'w:p']);
  });
});

describe('stripElements', () => {
  it('removes only a self-closing element, not everything after it', () => {
    const xml =
      '<w:r><w:t>before</w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>after</w:t></w:r>';
    expect(runText(stripElements(xml, ['w:commentRangeStart']), 'w')).toBe('beforeafter');
  });

  it('still removes a nested element with its children', () => {
    const xml = '<w:t>keep</w:t><w:del><w:del><w:t>gone</w:t></w:del></w:del><w:t>!</w:t>';
    expect(runText(stripElements(xml, ['w:del']), 'w')).toBe('keep!');
  });
});

describe('runText', () => {
  it('reads a line break as a space between words', () => {
    const xml =
      '<w:r><w:t># Personal store</w:t></w:r><w:r><w:br /></w:r><w:r><w:t>Get-ChildItem Cert:</w:t></w:r>';
    expect(runText(xml, 'w')).toBe('# Personal store Get-ChildItem Cert:');
  });

  it('still joins runs with no separator, so a word split across runs stays whole', () => {
    expect(runText('<w:r><w:t>escal</w:t></w:r><w:r><w:t>ation</w:t></w:r>', 'w')).toBe(
      'escalation',
    );
  });

  it('ignores an empty self-closing text element', () => {
    expect(runText('<w:t xml:space="preserve"/><w:r><w:t>text</w:t></w:r>', 'w')).toBe('text');
  });
});

describe('extractDocx', () => {
  it('does not let an empty paragraph swallow the table after it', () => {
    const table =
      '<w:tbl><w:tr><w:tc>' +
      p('Step') +
      '</w:tc><w:tc>' +
      p('Action') +
      '</w:tc></w:tr>' +
      '<w:tr><w:tc>' +
      p('1') +
      '</w:tc><w:tc>' +
      p('Restart the queue') +
      '</w:tc></w:tr></w:tbl>';
    const text = textOf(docx(p('Intro') + '<w:p w14:paraId="672A6659" />' + table + p('Outro')));
    expect(text).toBe('Intro\nStep — Action\n1 — Restart the queue\nOutro');
  });

  it("reads a one-cell callout box's paragraphs as separate lines", () => {
    const callout = `<w:tbl><w:tr><w:tc>${p('Purpose')}${p('This SOP explains renewal.')}</w:tc></w:tr></w:tbl>`;
    expect(textOf(docx(callout))).toBe('Purpose\nThis SOP explains renewal.');
  });

  it("joins a multi-cell row's paragraphs with a space, keeping one line per row", () => {
    const row = `<w:tbl><w:tr><w:tc>${p('Modules:')}</w:tc><w:tc>${p('Printing Service')}${p('RxJobTicketService')}</w:tc></w:tr></w:tbl>`;
    expect(textOf(docx(row))).toBe('Modules: — Printing Service RxJobTicketService');
  });

  it('keeps the text after a comment anchor', () => {
    const body =
      '<w:p><w:r><w:t>Escalate to </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>the shift lead</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
      p('Close the ticket.');
    expect(textOf(docx(body))).toBe('Escalate to the shift lead\nClose the ticket.');
  });

  it('drops hidden runs and keeps their visible siblings', () => {
    const body =
      '<w:p><w:r><w:t>Visible </w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r><w:r><w:t>text</w:t></w:r></w:p>';
    expect(textOf(docx(body))).toBe('Visible text');
  });
});

describe('extractPptx', () => {
  it('keeps the slide text after a chart reference', () => {
    const A =
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
    const slide = `<p:sld ${A}><p:cSld><p:spTree><a:p><a:r><a:t>Before the chart</a:t></a:r></a:p><c:chart r:id="rId2"/><a:p/><a:p><a:r><a:t>After</a:t></a:r><a:br/><a:r><a:t>the chart</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`;
    const bytes = zipOf({
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      'ppt/slides/slide1.xml': slide,
    });
    expect(extractPptx(bytes).blocks.map((block) => block.text)).toEqual([
      'Before the chart\nAfter the chart',
    ]);
  });
});
