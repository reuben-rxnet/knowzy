// The Word download of an assessment-prepared document (AI Document Studio
// M3, docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.7).
//
// A minimal, valid WordprocessingML package written by hand: content types,
// relationships, styles, core properties and the document. Headings use the
// built-in Heading1-3 style ids, so Word's navigation pane and the platform's
// own DOCX extractor both see them; tables are real tables; warnings and
// missing-information markers are shaded paragraphs with a bold label, so
// they survive printing in black and white.

import type { PreparedDocumentExport, PreparedNode } from '@knowzy/shared-types';
import { preparedNotice } from '@knowzy/shared-types';
import { writeZip } from './zip-writer.js';

/** XML 1.0 forbids most control characters; they are dropped, never escaped. */
const xmlAllowed = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    code >= 0x10000
  );
};

export const xmlEscape = (text: string): string =>
  [...text]
    .filter(xmlAllowed)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const run = (text: string, props = ''): string =>
  `<w:r>${props === '' ? '' : `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;

const paragraph = (runs: string, props = ''): string =>
  `<w:p>${props === '' ? '' : `<w:pPr>${props}</w:pPr>`}${runs}</w:p>`;

const shaded = (fill: string): string =>
  `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:spacing w:before="120" w:after="120"/><w:ind w:left="240" w:right="240"/>`;

const MARKER_LABEL: Readonly<Record<string, string>> = {
  MISSING_INFORMATION: 'Missing information: ',
  UNCLEAR: 'Unclear: ',
  NOT_FOR_ASSESSMENT: 'Not suitable for assessment: ',
};

const nodeXml = (node: PreparedNode): string => {
  switch (node.type) {
    case 'heading':
      return paragraph(run(node.text), `<w:pStyle w:val="Heading${Math.min(3, node.level)}"/>`);
    case 'paragraph':
      return paragraph(run(node.text));
    case 'list':
      return node.items
        .map((item, index) =>
          paragraph(
            run(`${node.ordered ? `${index + 1}.` : '•'}\t${item}`),
            '<w:ind w:left="720" w:hanging="360"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>',
          ),
        )
        .join('');
    case 'warning':
      return paragraph(run('Warning: ', '<w:b/>') + run(node.text), shaded('FFF4CE'));
    case 'marker':
      return paragraph(
        run(MARKER_LABEL[node.marker] ?? 'Note: ', '<w:b/>') + run(node.text, '<w:i/>'),
        shaded('E8F0FE'),
      );
    case 'table': {
      const width = Math.max(1, node.header.length);
      const cellXml = (text: string, header: boolean): string =>
        `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / width)}" w:type="dxa"/>${
          header ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' : ''
        }</w:tcPr>${paragraph(run(text, header ? '<w:b/>' : ''))}</w:tc>`;
      const row = (cells: readonly string[], header: boolean): string =>
        `<w:tr>${Array.from({ length: width }, (_, i) => cellXml(cells[i] ?? '', header)).join('')}</w:tr>`;
      const border = (side: string): string =>
        `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
      return (
        `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${[
          'top',
          'left',
          'bottom',
          'right',
          'insideH',
          'insideV',
        ]
          .map(border)
          .join('')}</w:tblBorders></w:tblPr>` +
        row(node.header, true) +
        node.rows.map((cells) => row(cells, false)).join('') +
        `</w:tbl>${paragraph('')}`
      );
    }
  }
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** The lines that follow the notice: where this came from, and which version. */
export const provenanceLines = (doc: PreparedDocumentExport): string[] => [
  `Original document: ${doc.originalName} (version ${doc.originalVersion})`,
  `Prepared document version: ${doc.preparedVersion}`,
  `Prepared by: ${doc.preparedBy}, ${doc.preparedAt}`,
];

export const writePreparedDocx = (doc: PreparedDocumentExport): Buffer => {
  const body = [
    paragraph(run(doc.title), '<w:pStyle w:val="Title"/>'),
    paragraph(run(preparedNotice(doc.originalName), '<w:b/>'), shaded('F2F2F2')),
    ...provenanceLines(doc).map((line) => paragraph(run(line, '<w:sz w:val="18"/>'))),
    ...doc.nodes.map(nodeXml),
  ].join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(doc.title)}</dc:title><dc:description>${xmlEscape(preparedNotice(doc.originalName))}</dc:description></cp:coreProperties>`;
  return writeZip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['word/document.xml', documentXml],
    ['word/_rels/document.xml.rels', DOCUMENT_RELS],
    ['word/styles.xml', STYLES],
    ['docProps/core.xml', core],
  ]);
};
