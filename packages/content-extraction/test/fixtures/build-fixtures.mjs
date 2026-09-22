// Builds the binary extraction fixtures, deterministically.
//
// The fixtures are hand-built rather than copied from a real document for two
// reasons. They contain no corporate content, so the corpus of a customer
// never enters this repository through a test. And every byte is controlled
// here, so a fixture cannot drift: `node build-fixtures.mjs` reproduces the
// exact same files, which is what makes a byte-level regression meaningful.
//
// Run from this directory:  node build-fixtures.mjs

import { deflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;

// ---------------------------------------------------------------- PDF

const escapePdfText = (text) =>
  text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** One content stream per page, using real BT/Tf/Td/Tj/ET operators. */
const pdfContentStream = (lines) => {
  let out = 'BT\n/F1 12 Tf\n';
  let y = 720;
  for (const line of lines) {
    out += `1 0 0 1 72 ${y} Tm\n(${escapePdfText(line)}) Tj\n`;
    y -= 18;
  }
  return `${out}ET\n`;
};

/**
 * A minimal but structurally valid PDF: catalog, page tree, one Type1 font,
 * and a content stream per page, with a correct cross-reference table.
 */
const buildPdf = (pages) => {
  const objects = [];
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers
    .map((n) => `${n} 0 R`)
    .join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((lines, index) => {
    const pageNumber = pageObjectNumbers[index];
    const contentNumber = pageNumber + 1;
    objects[pageNumber] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    const stream = pdfContentStream(lines);
    objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });

  let body = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, 'latin1');
};

/** A PDF whose pages carry no text operators at all — the image-only case. */
const buildTextlessPdf = () => {
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>';
  const stream = '0.5 0.5 0.5 rg\n72 72 468 648 re\nf\n';
  objects[4] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;

  let body = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
};

// ---------------------------------------------------------------- ZIP / DOCX

/**
 * A minimal ZIP writer. Deterministic: fixed timestamps, so a rebuild produces
 * identical bytes.
 */
const buildZip = (entries) => {
  const chunks = [];
  const central = [];
  let offset = 0;

  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  const crc32 = (buffer) => {
    let c = -1;
    for (const byte of buffer) c = (c >>> 8) ^ crcTable[(c ^ byte) & 0xff];
    return (c ^ -1) >>> 0;
  };

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const deflated = deflateRawSync(raw, { level: 9 });
    const useDeflate = entry.store !== true && deflated.length < raw.length;
    const stored = useDeflate ? deflated : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10); // fixed time
    local.writeUInt16LE(0x21, 12); // fixed date: 1980-01-01
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBytes, stored);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(useDeflate ? 8 : 0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc32(raw), 16);
    header.writeUInt32LE(stored.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, nameBytes]));

    offset += local.length + nameBytes.length + stored.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
};

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** Splits one paragraph across several runs, which Word does constantly. */
const splitRunPara = (parts) =>
  `<w:p><w:r><w:t xml:space="preserve">${parts.join(
    '</w:t></w:r><w:r><w:t xml:space="preserve">',
  )}</w:t></w:r></w:p>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${para('SSL Certificate Renewal', 'Heading1')}
${para('Scope', 'Heading2')}
${splitRunPara([
  'A certificate must be renewed no later than ',
  'thirty',
  ' days before its expiry date.',
])}
${para('The service owner must record the renewal in the change log before the certificate is installed.')}
${para('Escalation', 'Heading2')}
${para('If a renewal fails twice, the duty manager must be notified within one hour.')}
<w:p><w:del w:id="9" w:author="A Reviewer"><w:r><w:delText xml:space="preserve">A deleted sentence stating a renewal window of ninety days.</w:delText></w:r></w:del></w:p>
${para('An inserted sentence: the certificate authority must confirm receipt within one hour.')}
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Environment</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Renewal window</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Production</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30 days</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
${para('The renewal request must be approved by the team leader before submission to the certificate authority.')}
</w:body></w:document>`;

const EMPTY_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t xml:space="preserve">   </w:t></w:r></w:p>
</w:body></w:document>`;

const docx = (documentXml) =>
  buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: RELS },
    { name: 'word/document.xml', content: documentXml },
  ]);

// ---------------------------------------------------------------- PPTX

const slideXml = (paragraphs) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
<p:sp><p:txBody>
${paragraphs.map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('')}
</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rIdB"/><p:sldId id="257" r:id="rIdA"/></p:sldIdLst>
</p:presentation>`;

// rIdB points at slide2 and comes FIRST, so a correct reader emits slide2's
// text before slide1's. Sorting parts numerically would get this wrong, which
// is exactly what the ordering test asserts.
const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rIdB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;

const pptx = () =>
  buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: RELS },
    { name: 'ppt/presentation.xml', content: PRESENTATION_XML },
    { name: 'ppt/_rels/presentation.xml.rels', content: PRESENTATION_RELS },
    {
      name: 'ppt/slides/slide1.xml',
      content: slideXml([
        'Escalation path',
        'A failed renewal must be escalated to the duty manager within one hour.',
      ]),
    },
    {
      name: 'ppt/slides/slide2.xml',
      content: slideXml([
        'Certificate policy overview',
        'Every production certificate must be renewed thirty days before expiry.',
      ]),
    },
  ]);

// ---------------------------------------------------------------- XLSX

const SHARED_STRINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8">
<si><t>Environment</t></si>
<si><t>Renewal window</t></si>
<si><t>Approver</t></si>
<si><t>Production</t></si>
<si><t>30 days before expiry</t></si>
<si><t>The team leader must approve every production renewal request.</t></si>
<si><t>Staging</t></si>
<si><t>The duty manager approves a staging renewal.</t></si>
</sst>`;

const SHEET_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row>
<row r="3"><c r="A3"><f>SUM(1,1)</f><v>2</v></c></row>
<row r="4"><c r="A4" t="s"><v>6</v></c><c r="C4" t="s"><v>7</v></c></row>
</sheetData></worksheet>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Certificate policy" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

const xlsx = () =>
  buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: RELS },
    { name: 'xl/workbook.xml', content: WORKBOOK_XML },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS },
    { name: 'xl/sharedStrings.xml', content: SHARED_STRINGS },
    { name: 'xl/worksheets/sheet1.xml', content: SHEET_XML },
  ]);

// A container whose single entry declares a wildly implausible inflated size,
// which the ratio guard must refuse BEFORE inflating anything.
const zipBomb = () => {
  const highlyCompressible = 'A'.repeat(2 * 1024 * 1024);
  return buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: RELS },
    { name: 'word/document.xml', content: highlyCompressible },
  ]);
};

// ---------------------------------------------------------------- write

const write = (name, buffer) => {
  writeFileSync(join(HERE, name), buffer);
  console.log(`${name}  ${buffer.length} bytes`);
};

write(
  'sop-two-page.pdf',
  buildPdf([
    [
      'SSL Certificate Renewal',
      'A certificate must be renewed no later than thirty days before',
      'its expiry date. The service owner must record the renewal in',
      'the change log before the certificate is installed.',
    ],
    [
      'Escalation',
      'If a renewal fails twice, the duty manager must be notified',
      'within one hour of the second failure.',
    ],
  ]),
);
write('image-only.pdf', buildTextlessPdf());
write('sop.docx', docx(DOCUMENT_XML));
write('empty.docx', docx(EMPTY_DOCUMENT_XML));
write('not-a-zip.docx', Buffer.from('This is not a ZIP container at all.', 'utf8'));
write('truncated.pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog', 'latin1'));
write('deck.pptx', pptx());
write('policy.xlsx', xlsx());
write('bomb.docx', zipBomb());
