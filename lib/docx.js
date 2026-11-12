/* 浏览器端 .docx 生成器（JSZip + 手写 OOXML，零后端、零外部服务）
   用法：
     const blob = await TADocx.build({ title, subtitle, meta:[...], blocks:[...] });
     TADocx.download('教案.docx', blob);
   或：
     const blob = await TADocx.fromMarkdown({ title, subtitle, meta, md });
   依赖：vendor/jszip.min.js（全局 JSZip）。
*/
(function (global) {
  'use strict';

  const FONT_SONG = '宋体';
  const FONT_HEI = '黑体';
  const FONT_KAI = '楷体';
  const COLOR_NAVY = '1F4E79';
  const COLOR_GREY = '595959';
  const COLOR_RED = 'C0392B';
  const COLOR_TIP = '2E75B6';

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function t(text) {
    return '<w:t xml:space="preserve">' + xmlEsc(text).replace(/\r\n?/g, '\n').replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">') + '</w:t>';
  }
  function run(text, o) {
    o = o || {};
    const rPr = [];
    rPr.push('<w:rPr>');
    if (o.font) rPr.push('<w:rFonts w:ascii="' + o.font + '" w:eastAsia="' + o.font + '" w:hAnsi="' + o.font + '"/>');
    if (o.bold) rPr.push('<w:b/><w:bCs/>');
    if (o.italic) rPr.push('<w:i/><w:iCs/>');
    if (o.color) rPr.push('<w:color w:val="' + o.color + '"/>');
    if (o.size) rPr.push('<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>');
    if (o.underline) rPr.push('<w:u w:val="single"/>');
    rPr.push('</w:rPr>');
    return '<w:r>' + rPr.join('') + t(text) + '</w:r>';
  }
  function para(runsXml, o) {
    o = o || {};
    const p = ['<w:p><w:pPr>'];
    if (o.pageBreakBefore) p.push('<w:pageBreakBefore/>');
    if (o.keepNext) p.push('<w:keepNext/>');
    if (o.borderBottom) p.push('<w:pBdr><w:bottom w:val="dashed" w:sz="4" w:space="1" w:color="B9B4A8"/></w:pBdr>');
    if (o.shd) p.push('<w:shd w:val="clear" w:fill="' + o.shd + '"/>');
    if (o.spacing) p.push('<w:spacing w:before="' + (o.spacing.before || 0) + '" w:after="' + (o.spacing.after || 0) + '" w:line="' + (o.spacing.line || 360) + '" w:lineRule="auto"/>');
    if (o.indent) p.push('<w:ind w:left="' + o.indent + '"/>');
    if (o.align) p.push('<w:jc w:val="' + o.align + '"/>');
    p.push('</w:pPr>');
    p.push(runsXml || '<w:r><w:t xml:space="preserve"> </w:t></w:r>');
    p.push('</w:p>');
    return p.join('');
  }
  function heading(text, level) {
    const size = level === 1 ? 34 : level === 2 ? 28 : 24;
    const font = FONT_HEI;
    return para(run(text, { font: font, bold: true, color: level === 1 ? COLOR_NAVY : level === 2 ? '2C3E50' : '334155', size: size }), {
      keepNext: true,
      spacing: { before: level === 1 ? 240 : 180, after: 100, line: 300 },
    });
  }
  function p(text, o) {
    o = o || {};
    return para(run(text, { font: o.font || FONT_SONG, bold: o.bold, italic: o.italic, color: o.color, size: o.size || 21 }), {
      spacing: { before: o.before == null ? 20 : o.before, after: o.after == null ? 60 : o.after, line: o.line || 360 },
      indent: o.indent,
      align: o.align,
      borderBottom: o.borderBottom,
      shd: o.shd,
    });
  }
  function bullet(text) {
    return para(run('•  ', { font: FONT_SONG, size: 21 }) + run(text, { font: FONT_SONG, size: 21 }), {
      spacing: { before: 0, after: 30, line: 340 }, indent: 360,
    });
  }
  function numbered(n, text) {
    return para(run(n + '. ', { font: FONT_SONG, bold: true, size: 21 }) + run(text, { font: FONT_SONG, size: 21 }), {
      spacing: { before: 0, after: 30, line: 340 }, indent: 360,
    });
  }
  function quote(text) {
    return para(run(text, { font: FONT_KAI, italic: true, color: COLOR_GREY, size: 21 }), {
      spacing: { before: 60, after: 60, line: 340 }, indent: 420, shd: 'F4F1EA',
    });
  }
  function hr() {
    return para('', { borderBottom: true, spacing: { before: 80, after: 80, line: 240 } });
  }
  function pageBreak() {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
  function cell(text, o) {
    o = o || {};
    const w = o.width ? '<w:tcW w:w="' + o.width + '" w:type="dxa"/>' : '';
    const shd = o.header ? '<w:shd w:val="clear" w:fill="E8EEF2"/>' : '';
    return '<w:tc><w:tcPr>' + w + shd + '<w:vAlign w:val="center"/></w:tcPr>' +
      para(run(String(text == null ? '' : text), { font: FONT_SONG, bold: !!o.header, size: 20 }), {
        spacing: { before: 20, after: 20, line: 260 }, align: o.align || 'left',
      }) + '</w:tc>';
  }
  function table(rows, o) {
    o = o || {};
    if (!Array.isArray(rows) || !rows.length) return '';
    const cols = Math.max.apply(null, rows.map((r) => (r ? r.length : 0)));
    const total = 9000;
    const widths = o.widths && o.widths.length === cols ? o.widths : Array(cols).fill(Math.floor(total / cols));
    const grid = '<w:tblGrid>' + widths.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>';
    const body = rows.map((row, ri) => {
      const cells = [];
      for (let ci = 0; ci < cols; ci++) {
        cells.push(cell(row && row[ci] != null ? row[ci] : '', { width: widths[ci], header: ri === 0 }));
      }
      return '<w:tr>' + cells.join('') + '</w:tr>';
    }).join('');
    return '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/><w:jc w:val="center"/>' +
      '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => '<w:' + s + ' w:val="single" w:sz="4" w:color="9AA5A8"/>').join('') + '</w:tblBorders>' +
      '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr>' + grid + body + '</w:tbl>';
  }

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + FONT_SONG + '" w:eastAsia="' + FONT_SONG + '" w:hAnsi="' + FONT_SONG + '"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="' + FONT_HEI + '"/><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
    '</w:styles>';

  const FOOTER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:eastAsia="' + FONT_SONG + '"/><w:sz w:val="18"/><w:color w:val="808080"/></w:rPr><w:t xml:space="preserve">教学助手 · 轻量版   第 </w:t></w:r>' +
    '<w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="808080"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>' +
    '<w:r><w:rPr><w:rFonts w:eastAsia="' + FONT_SONG + '"/><w:sz w:val="18"/><w:color w:val="808080"/></w:rPr><w:t xml:space="preserve"> 页</w:t></w:r>' +
    '</w:p></w:ftr>';

  const CORE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + xmlEsc('教学助手文档') + '</dc:title><dc:creator>教学助手 · 轻量版</dc:creator><cp:lastModifiedBy>教学助手 · 轻量版</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:modified>' +
    '</cp:coreProperties>';

  const APP = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>教学助手 · 轻量版</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>';

  function documentXml(blocks) {
    const body = (blocks || []).map((b) => {
      switch (b.type) {
        case 'title': return para(run(b.text, { font: FONT_HEI, bold: true, color: COLOR_NAVY, size: 36 }), { align: 'center', spacing: { before: 0, after: 100, line: 320 } });
        case 'subtitle': return para(run(b.text, { font: FONT_KAI, color: '555555', size: 22 }), { align: 'center', spacing: { before: 0, after: 120, line: 300 } });
        case 'meta': return para(run(b.text, { font: FONT_SONG, color: COLOR_GREY, size: 19 }), { align: 'center', spacing: { before: 0, after: 40, line: 260 } });
        case 'h1': return heading(b.text, 1);
        case 'h2': return heading(b.text, 2);
        case 'h3': return heading(b.text, 3);
        case 'p': return p(b.text, b);
        case 'bullet': return bullet(b.text);
        case 'num': return numbered(b.n || '', b.text);
        case 'quote': return quote(b.text);
        case 'hr': return hr();
        case 'pagebreak': return pageBreak();
        case 'table': return table(b.rows, b);
        case 'note': return p(b.text, { font: FONT_KAI, color: COLOR_TIP, size: 20, shd: 'F2F7FB' });
        default: return b.text ? p(String(b.text)) : '';
      }
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + body +
      '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>' +
      '<w:cols w:space="720"/><w:docGrid w:linePitch="312"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  async function build(opts) {
    if (!global.JSZip) throw new Error('缺少 JSZip（vendor/jszip.min.js）');
    const o = opts || {};
    const zip = new global.JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>');
    zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>');
    const word = zip.folder('word');
    word.file('document.xml', documentXml(o.blocks || []));
    word.file('styles.xml', STYLES);
    word.file('footer1.xml', FOOTER);
    word.folder('_rels').file('document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      '</Relationships>');
    zip.folder('docProps').file('core.xml', CORE);
    zip.folder('docProps').file('app.xml', APP);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }

  function stripInline(s) {
    return String(s == null ? '' : s)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<br\s*\/?>/gi, ' ')
      .trim();
  }

  function markdownToBlocks(md) {
    const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }
      if (/^```/.test(line)) {
        const buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
        i++;
        blocks.push({ type: 'p', text: buf.join('\n'), font: 'Consolas', size: 19, shd: 'F5F5F5' });
        continue;
      }
      let m = /^(#{1,6})\s+(.*)$/.exec(line);
      if (m) { blocks.push({ type: 'h' + Math.min(3, m[1].length), text: stripInline(m[2]) }); i++; continue; }
      if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const split = (s) => {
          let x = s.trim();
          if (x.startsWith('|')) x = x.slice(1);
          if (x.endsWith('|')) x = x.slice(0, -1);
          return x.split('|').map((y) => stripInline(y.trim()));
        };
        const rows = [split(line)];
        i += 2;
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { rows.push(split(lines[i])); i++; }
        blocks.push({ type: 'table', rows });
        continue;
      }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) { buf.push(stripInline(lines[i].trim().replace(/^>\s?/, ''))); i++; }
        blocks.push({ type: 'quote', text: buf.join('\n') });
        continue;
      }
      m = /^[-*+]\s+(.*)$/.exec(line);
      if (m) { blocks.push({ type: 'bullet', text: stripInline(m[1]) }); i++; continue; }
      m = /^(\d+)[.)]\s+(.*)$/.exec(line);
      if (m) { blocks.push({ type: 'num', n: m[1], text: stripInline(m[2]) }); i++; continue; }
      // 连续普通行合并为一段
      const buf = [stripInline(line)];
      i++;
      while (i < lines.length) {
        const nxt = lines[i].trim();
        if (!nxt || /^(#{1,6})\s+/.test(nxt) || /^[-*+]\s+/.test(nxt) || /^(\d+)[.)]\s+/.test(nxt) || /^```/.test(nxt) || /^>\s?/.test(nxt) || /^(\-{3,}|\*{3,}|_{3,})$/.test(nxt)) break;
        buf.push(stripInline(nxt));
        i++;
      }
      blocks.push({ type: 'p', text: buf.join('\n') });
    }
    return blocks;
  }

  async function fromMarkdown(opts) {
    const o = opts || {};
    const blocks = [];
    if (o.title) blocks.push({ type: 'title', text: o.title });
    if (o.subtitle) blocks.push({ type: 'subtitle', text: o.subtitle });
    (o.meta || []).forEach((m) => blocks.push({ type: 'meta', text: m }));
    if (o.title || o.subtitle || (o.meta && o.meta.length)) blocks.push({ type: 'hr' });
    blocks.push.apply(blocks, markdownToBlocks(o.md || ''));
    return build({ blocks });
  }

  function download(filename, blob) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename || '文档.docx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1500);
  }

  function safeName(s) {
    return String(s == null ? '' : s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || '文档';
  }

  global.TADocx = { build, fromMarkdown, markdownToBlocks, download, safeName, xmlEsc };
})(window);
