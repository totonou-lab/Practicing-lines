// 日本語の辞書（kuromoji）で漢字に読み仮名を付け、読み上げの読み間違いを減らす。
// 辞書は約17MBあるため、使うときに初めて読み込む（2回目からは端末に保存されたものを使う）。
(function (global) {
  'use strict';

  const KANJI = /[一-鿿々〆ヶ]/;
  // 文脈で読み方が変わりやすい1文字の言葉は、辞書を使わず iPhone の読み方に任せる
  const AMBIGUOUS = new Set(['何', '他', '氏', '悪', '方', '後', '行', '生', '風', '分', '上', '下', '中', '日', '月', '色', '体', '主']);

  let tokenizer = null;
  let loading = null;

  function load() {
    if (tokenizer) return Promise.resolve(tokenizer);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        kuromoji.builder({ dicPath: 'lib/dict/' }).build((err, t) => {
          if (err) { loading = null; reject(err); return; }
          tokenizer = t;
          resolve(t);
        });
      });
    }
    return loading;
  }

  const toHiragana = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

  // 辞書の準備ができていなければ、そのままの文を返す
  function convert(text) {
    if (!tokenizer || !KANJI.test(text)) return text;
    const ts = tokenizer.tokenize(text);
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const s = t.surface_form;
      if (!KANJI.test(s)) { out.push(s); continue; }
      // 漢字の言葉を細かく切った所（例: 二｜人）は、辞書の読みが外れやすいので任せる
      const joinedBefore = i > 0 && KANJI.test(ts[i - 1].surface_form.slice(-1)) && KANJI.test(s[0]);
      const joinedAfter = i < ts.length - 1 && KANJI.test(s.slice(-1)) && KANJI.test(ts[i + 1].surface_form[0]);
      const usable = t.word_type === 'KNOWN' && t.reading && t.reading !== '*' &&
        !joinedBefore && !joinedAfter && !AMBIGUOUS.has(s.replace(/[^一-鿿々〆ヶ]/g, ''));
      out.push(usable ? toHiragana(t.reading) : s);
    }
    return out.join('');
  }

  global.Reading = { load, convert, isReady: () => !!tokenizer };
})(window);
