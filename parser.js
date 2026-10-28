// 台本ファイル（PDF / Word / テキスト）を読み取り、セリフ・ト書きの一覧に変換する。
// 流れ: ファイル → 「行」(rows: 字下げ量と文字のかたまり) → 分類 (lines)
(function (global) {
  'use strict';

  const CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/';
  const NAME_MAX = 10; // 役名とみなす最大文字数
  const NAME_SEP = /[・、,，&＆]/;

  function mode(values, step) {
    const counts = new Map();
    let best = null, bestCount = 0;
    for (const v of values) {
      const k = Math.round(v / step) * step;
      const c = (counts.get(k) || 0) + 1;
      counts.set(k, c);
      if (c > bestCount) { best = k; bestCount = c; }
    }
    return best;
  }

  function median(values) {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // ---------- PDF ----------

  // 1ページ分の文字を「行」（縦書きなら列）にまとめる
  function pageRows(items, pageHeight) {
    const glyphs = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || it.height || 10;
      glyphs.push({ str: it.str, size, x: t[4], y: pageHeight - t[5], w: it.width, h: it.height });
    }
    if (!glyphs.length) return { rows: [], vertical: false };

    // 縦書きか横書きかを、文字が並ぶ向きで判定する
    let vScore = 0, hScore = 0;
    for (let i = 1; i < glyphs.length; i++) {
      const a = glyphs[i - 1], b = glyphs[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) < a.size * 0.3 && dy > 0 && dy < a.size * 3) vScore++;
      if (Math.abs(dy) < a.size * 0.3 && dx > 0 && dx < a.size * 3) hScore++;
    }
    const vertical = vScore > hScore;

    // ふりがな（小さい文字）を除く
    const medSize = median(glyphs.map(g => g.size));
    const main = glyphs.filter(g => g.size >= medSize * 0.7);

    const placed = main.map(g => vertical
      ? { str: g.str, size: g.size, key: g.x, start: g.y - g.size, end: g.y - g.size + g.str.length * g.size }
      : { str: g.str, size: g.size, key: g.y, start: g.x, end: g.x + (g.w || g.str.length * g.size) });

    placed.sort((a, b) => a.key - b.key);
    const groups = [];
    for (const g of placed) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(g.key - last.key) < medSize * 0.5) {
        last.glyphs.push(g);
      } else {
        groups.push({ key: g.key, glyphs: [g] });
      }
    }
    // 縦書きは右の列から、横書きは上の行から読む
    groups.sort((a, b) => vertical ? b.key - a.key : a.key - b.key);

    const rows = groups.map(gr => {
      const gs = gr.glyphs.sort((a, b) => a.start - b.start);
      const size = median(gs.map(g => g.size));
      const segs = [];
      let cur = null, prevEnd = null;
      for (const g of gs) {
        if (cur && g.start - prevEnd < size * 0.8) {
          cur.text += g.str;
        } else {
          cur = { start: g.start, text: g.str };
          segs.push(cur);
        }
        prevEnd = Math.max(prevEnd ?? g.end, g.end);
      }
      return { key: gr.key, size, start: gs[0].start, end: prevEnd, segs };
    });
    return { rows, vertical };
  }

  async function rowsFromPdf(arrayBuffer) {
    // isEvalSupported: false … 細工されたPDFに仕込まれた命令が動かないようにする（CVE-2024-4367 対策）
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, cMapUrl: CMAP_URL, cMapPacked: true, isEvalSupported: false }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      pages.push(pageRows(tc.items, vp.height));
    }

    // 文書全体の「行頭の位置」と「行の間隔」を求める
    const all = pages.flatMap(p => p.rows);
    if (!all.length) return [];
    const size = median(all.map(r => r.size));
    const margin = mode(all.map(r => r.start), size / 2);
    const gaps = [];
    for (const p of pages) {
      for (let i = 1; i < p.rows.length; i++) gaps.push(Math.abs(p.rows[i].key - p.rows[i - 1].key));
    }
    const pitch = mode(gaps.filter(g => g > size * 0.5), size / 4) || size * 1.7;

    const out = [];
    pages.forEach((p, pi) => {
      p.rows.forEach((r, i) => {
        const prev = p.rows[i - 1];
        out.push({
          page: pi + 1,
          indent: (r.start - margin) / size,
          segs: r.segs.map(s => ({ text: s.text, indent: (s.start - margin) / size })),
          length: (r.end - r.start) / size,
          // 前の行と続いているか（空行をはさまない）。ページの最初の行は前ページから続いているとみなす
          adjacent: prev ? Math.abs(r.key - prev.key) < pitch * 1.4 : pi > 0,
        });
      });
    });
    return out;
  }

  // ---------- Word / テキスト ----------

  function rowsFromText(text) {
    const out = [];
    let prevBlank = true;
    for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
      if (!rawLine.trim()) { prevBlank = true; continue; }
      let indent = 0, i = 0;
      for (; i < rawLine.length; i++) {
        const c = rawLine[i];
        if (c === '　') indent += 1;
        else if (c === ' ') indent += 0.5;
        else if (c === '\t') indent += 2;
        else break;
      }
      const body = rawLine.slice(i).replace(/\s+$/, '');
      const segs = body.split(/[\t　]+| {2,}/).filter(Boolean).map(t => ({ text: t, indent: null }));
      out.push({ indent, segs, length: body.length, adjacent: !prevBlank });
      prevBlank = false;
    }
    return out;
  }

  async function rowsFromDocx(arrayBuffer) {
    const res = await mammoth.extractRawText({ arrayBuffer });
    return rowsFromText(res.value);
  }

  // ---------- 分類 ----------

  function rowText(row, from = 0) {
    return row.segs.slice(from).map(s => s.text).join(' ').trim();
  }

  function cleanName(name) {
    return name.replace(/[\s　]/g, '');
  }

  // 「名前　セリフ」「名前「セリフ」」「名前：セリフ」の形かどうか
  function splitSpeaker(row) {
    if (row.indent > 0.5) return null;
    const segs = row.segs;
    if (segs.length >= 2) {
      const name = cleanName(segs[0].text);
      if (name.length >= 1 && name.length <= NAME_MAX && !/[。！？!?]/.test(name)) {
        return { name, text: rowText(row, 1), textIndent: segs[1].indent };
      }
    }
    const full = rowText(row);
    const m = full.match(/^([^「『（(：:\s]{1,10})\s*([「『].*|[：:].*)$/);
    if (m) {
      let text = m[2].replace(/^[：:]\s*/, '');
      // 「」で全体を囲んだ行は、1回しか出てこない役でもセリフとみなす
      const quoted = /^「.*」$/.test(text);
      if (quoted) text = text.slice(1, -1);
      return { name: cleanName(m[1]), text, textIndent: null, quoted };
    }
    return null;
  }

  function isPageNumber(text) {
    return /^[-－‐ー\s　]*[0-9０-９]+[-－‐ー\s　]*$/.test(text) || /^[0-9０-９]+\s*[/／]\s*[0-9０-９]+$/.test(text);
  }

  function isSceneHeading(text) {
    return /^[【［\[〔＜<]/.test(text) || /^(シーン|ＳＣＥＮＥ|SCENE|Scene|第.{1,4}(場|幕|景))/.test(text) || /^[MＭ][0-9０-９]+/.test(text);
  }

  function classify(rows) {
    // 行の最後にくっついたページ番号を取り除く
    for (const r of rows) {
      if (r.segs.length > 1 && isPageNumber(r.segs[r.segs.length - 1].text)) r.segs.pop();
    }
    const cands = rows.map(splitSpeaker);

    // 役名の候補を数える。2回以上出てくる名前を役名とみなす
    const counts = new Map();
    for (const c of cands) if (c) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    // セリフの書き出し位置（PDFでタブ揃えされている場合）
    const textIndents = cands.filter(c => c && c.textIndent != null && counts.get(c.name) >= 2).map(c => c.textIndent);
    const dialogIndent = textIndents.length >= 3 ? mode(textIndents, 0.5) : null;
    // ト書きの書き出し位置（セリフより深く下げてあることが多い）
    const deeper = dialogIndent == null ? [] :
      rows.filter((r, i) => !cands[i] && r.indent > dialogIndent + 0.6).map(r => r.indent);
    const directionIndent = deeper.length ? mode(deeper, 0.5) : null;
    // セリフの続きとみなす字下げの上限（セリフ位置とト書き位置の中間）
    const contLimit = dialogIndent == null ? null :
      directionIndent == null ? dialogIndent + 0.6 : (dialogIndent + directionIndent) / 2;

    const isValidName = (name, textIndent, quoted) => {
      if ((counts.get(name) || 0) >= 2 || quoted) return true;
      if (dialogIndent != null && textIndent != null && Math.abs(textIndent - dialogIndent) < 0.6) return true;
      const parts = name.split(NAME_SEP).filter(Boolean);
      return parts.length > 1 && parts.every(p => (counts.get(p) || 0) >= 2);
    };

    const maxLen = Math.max(...rows.map(r => r.length));
    const lines = [];
    let prevRow = null;
    rows.forEach((row, i) => {
      const page = row.page || null; // PDFのときだけ、その行があるページ
      const text = rowText(row);
      const last = lines[lines.length - 1];
      const prev = prevRow;
      prevRow = row;
      if (!text || isPageNumber(text)) return;

      const c = cands[i];
      if (c && c.text && isValidName(c.name, c.textIndent, c.quoted)) {
        const parts = c.name.split(NAME_SEP).filter(Boolean);
        const speakers = (counts.get(c.name) || 0) >= 2 && parts.some(p => !counts.has(p)) ? [c.name] : parts;
        lines.push({ type: 'speech', speakers, text: c.text, page });
        return;
      }

      // 前のセリフの続き（折り返し）
      if (last && last.type === 'speech' && row.adjacent && prev) {
        const atDialogIndent = dialogIndent != null && row.indent > dialogIndent - 0.6 && row.indent < contLimit;
        const prevWasFull = prev.length >= maxLen * 0.9;
        if (atDialogIndent || (dialogIndent == null && prevWasFull && row.indent < 0.5)) {
          last.text += text;
          return;
        }
      }

      if (isSceneHeading(text)) {
        lines.push({ type: 'scene', speakers: [], text, page });
        return;
      }

      // ト書きの折り返し（文が終わっていなければつなげる）
      if (last && last.type === 'direction' && row.adjacent && prev &&
          Math.abs(row.indent - prev.indent) < 0.6 && !/[。」』）)！？!?]$/.test(last.text)) {
        last.text += text;
        return;
      }
      lines.push({ type: 'direction', speakers: [], text, page });
    });

    lines.forEach((l, i) => { l.id = i + 1; });
    return { lines, characters: characterList(lines) };
  }

  // 役名の一覧（セリフが多い順）
  function characterList(lines) {
    const counts = new Map();
    for (const l of lines) {
      if (l.type !== 'speech') continue;
      for (const s of l.speakers) counts.set(s, (counts.get(s) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }

  async function parseFile(file) {
    const name = file.name || '';
    const buf = await file.arrayBuffer();
    let rows;
    if (/\.pdf$/i.test(name)) rows = await rowsFromPdf(buf);
    else if (/\.docx$/i.test(name)) rows = await rowsFromDocx(buf);
    else if (/\.(txt|text)$/i.test(name)) rows = rowsFromText(new TextDecoder().decode(buf));
    else throw new Error('PDF・Word(.docx)・テキスト(.txt)のファイルを選んでください');
    if (!rows.length) throw new Error('文字を読み取れませんでした（画像だけのPDFは読み取れません）');
    return classify(rows);
  }

  global.ScriptParser = { parseFile, characterList };
})(window);
