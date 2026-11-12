/* 轻量 Markdown 渲染：只支持教案/分析常用的子集，全部先转义，避免 AI 输出注入 HTML。 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(s) {
    let t = esc(s);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }

  function isTableSep(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  }
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((x) => x.trim());
  }

  function render(md) {
    const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let list = null; // 'ul' | 'ol'
    let para = [];

    function flushPara() {
      if (para.length) {
        out.push('<p>' + para.map(inline).join('<br>') + '</p>');
        para = [];
      }
    }
    function closeList() {
      if (list) { out.push('</' + list + '>'); list = null; }
    }
    function openList(kind) {
      if (list !== kind) {
        closeList();
        out.push('<' + kind + '>');
        list = kind;
      }
    }

    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trim();

      // 代码块
      if (/^```/.test(line)) {
        flushPara(); closeList();
        const lang = line.slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
        i++;
        out.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 空行
      if (!line) { flushPara(); closeList(); i++; continue; }

      // 分隔线
      if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); i++; continue; }

      // 标题
      let m = /^(#{1,6})\s+(.*)$/.exec(line);
      if (m) {
        flushPara(); closeList();
        const lv = Math.min(6, m[1].length);
        out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 表格
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushPara(); closeList();
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push('<table><thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>');
        rows.forEach((r) => {
          out.push('<tr>' + head.map((_, idx) => '<td>' + inline(r[idx] || '') + '</td>').join('') + '</tr>');
        });
        out.push('</tbody></table>');
        continue;
      }

      // 引用
      if (/^>\s?/.test(line)) {
        flushPara(); closeList();
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          buf.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>');
        continue;
      }

      // 无序列表
      m = /^[-*+]\s+(.*)$/.exec(line);
      if (m) {
        flushPara(); openList('ul');
        out.push('<li>' + inline(m[1]) + '</li>');
        i++;
        continue;
      }

      // 有序列表
      m = /^(\d+)[.)]\s+(.*)$/.exec(line);
      if (m) {
        flushPara(); openList('ol');
        out.push('<li>' + inline(m[2]) + '</li>');
        i++;
        continue;
      }

      // 普通段落
      closeList();
      para.push(line);
      i++;
    }
    flushPara(); closeList();
    return out.join('\n');
  }

  function toText(md) {
    // 从 Markdown 粗略提取纯文本，用于复制/Word 段落
    return String(md == null ? '' : md)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '· ')
      .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  global.TAMD = { render, toText, esc };
})(window);
