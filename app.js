// 画面の表示と、練習（読み上げ）の進行
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');
  const titleEl = $('#title');
  const backBtn = $('#back');

  const DEFAULTS = {
    myChars: [],
    readDirections: true, // ト書きを読む
    readMine: false,      // 自分のセリフも読む
    advance: 'mic',       // 自分のセリフの後: mic=声で判断 / time=時間で判断 / button=ボタン
    showMine: true,       // 自分のセリフを画面に表示する
    rate: 1.0,
    silenceSec: 1.5,      // 言い終わったと判断するまでの無音の長さ
    timeFactor: 1.0,      // 時間で判断するときの待ち時間の倍率
    voices: {},           // 役ごとの声 { 役名: { uri, pitch } }
    position: 0,
    // 練習する範囲
    startKind: 'top',     // top / resume / scene / page / marker
    startScene: null,     // 場面の行 id
    startPage: 1,
    startMarker: null,    // マーカーの行 id
    endKind: 'end',       // end / scene / marker / page
    endPage: 1,
    rangeStart: 0,        // 実際に練習する範囲（行番号）
    stopAt: null,
  };
  const PITCHES = [1.0, 0.8, 1.2, 0.9, 1.1, 0.75, 1.3];
  // 声のタイプ: 声の性別・高さ・速さの組み合わせ
  const VOICE_TYPES = {
    child_m: { label: '男の子', gender: 'm', pitch: 1.5, rate: 1.1 },
    child_f: { label: '女の子', gender: 'f', pitch: 1.6, rate: 1.1 },
    young_m: { label: '若い男性', gender: 'm', pitch: 1.15, rate: 1.05 },
    young_f: { label: '若い女性', gender: 'f', pitch: 1.2, rate: 1.05 },
    adult_m: { label: '大人の男性', gender: 'm', pitch: 0.9, rate: 1.0 },
    adult_f: { label: '大人の女性', gender: 'f', pitch: 0.95, rate: 1.0 },
    old_m: { label: 'おじいさん', gender: 'm', pitch: 0.7, rate: 0.85 },
    old_f: { label: 'おばあさん', gender: 'f', pitch: 0.8, rate: 0.85 },
  };
  const TYPE_LABEL = { speech: 'セリフ', direction: 'ト書き', scene: '場面', skip: '読まない' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 足りない設定を初期値で埋める。画面の各所が同じ設定を書き換えられるよう、同じものを返す
  function settingsOf(script) {
    const s = script.settings = script.settings || {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (!(k in s)) s[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    }
    return s;
  }

  // action を渡すと、お知らせの中にボタン（例: 元に戻す）を出す
  function toast(msg, action) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('has-action', !!action);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.onclick = () => { t.classList.remove('show'); action.run(); };
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), action ? 7000 : 3000);
  }

  function setHeader(title, backHash, settingsHash, backLabel) {
    titleEl.textContent = title;
    backBtn.hidden = !backHash;
    backBtn.textContent = backLabel ? `‹ ${backLabel}` : '‹';
    backBtn.classList.toggle('with-label', !!backLabel);
    backBtn.onclick = () => { location.hash = backHash; };
    const gear = $('#settings');
    gear.hidden = !settingsHash;
    gear.onclick = null;
    if (settingsHash) gear.href = settingsHash;
  }

  async function save(script) {
    script.updatedAt = Date.now();
    await ScriptDB.put(script);
  }

  let saveTimer = null;
  function saveSoon(script) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ScriptDB.put(script), 800);
  }

  function refreshCharacters(script) {
    script.characters = ScriptParser.characterList(script.lines);
    const s = settingsOf(script);
    s.myChars = s.myChars.filter(c => script.characters.includes(c));
  }

  // ---------- 画面の切り替え ----------

  let player = null;

  async function route() {
    if (player) { player.stop(); player = null; }
    releaseWakeLock();
    document.body.classList.remove('playing');
    window.scrollTo(0, 0);
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      if (parts[0] === 's' && parts[1]) {
        const script = await ScriptDB.get(parts[1]);
        if (!script) { location.hash = '#/'; return; }
        settingsOf(script);
        if (parts[2] === 'edit') return renderEdit(script);
        if (parts[2] === 'play') return renderPlay(script);
        return renderSetup(script, parts[2] === 'settings'); // settings = 練習の途中で開いた設定
      }
      return renderHome();
    } catch (e) {
      console.error(e);
      view.innerHTML = `<p class="error">エラーが起きました: ${esc(e.message)}</p>`;
    }
  }
  window.addEventListener('hashchange', route);
  // 声の一覧が後から届いたら、設定画面を描き直す
  window.addEventListener('voices-updated', () => {
    if (/^#\/s\/[^/]+(\/settings)?$/.test(location.hash) && !$('#dialog').open) route();
  });

  // ---------- ホーム（台本の一覧） ----------

  async function renderHome() {
    setHeader('セリフ稽古', null);
    const scripts = (await ScriptDB.all()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    view.innerHTML = `
      <section class="home">
        <label class="btn primary big file-btn">
          ＋ 台本を読み込む
          <input type="file" id="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden>
        </label>
        <p class="hint">PDF・Word（.docx）・テキスト（.txt）が読み込めます。<br>読み込んだ台本はこの端末に保存され、次からはすぐに使えます。</p>
        <ul class="script-list">
          ${scripts.map(s => {
            const st = settingsOf(s);
            const me = st.myChars.length ? `あなたの役: ${esc(st.myChars.join('・'))}` : '役が未選択';
            return `<li><a href="#/s/${s.id}">
              <span class="name">${esc(s.title)}</span>
              <span class="meta">${s.lines.length}行・${s.characters.length}人　${me}</span>
            </a></li>`;
          }).join('') || '<li class="empty">まだ台本がありません</li>'}
        </ul>
        ${howToOpenHtml(!scripts.length)}
      </section>`;
    $('#file').addEventListener('change', e => importFile(e.target.files[0]));
  }

  // ホーム画面に追加して開いているか
  function isInstalled() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  function howToOpenHtml(open) {
    const now = isInstalled() ? 'いまは「アプリとして」開いています。' : 'いまは「ブラウザで」開いています。';
    return `
      <details class="howto" ${open ? 'open' : ''}>
        <summary>📱 このアプリの開き方（2種類）</summary>
        <p class="now">${now}</p>
        <div class="way">
          <h3>① ブラウザで使う（ブックマーク）</h3>
          <p>Safari や Chrome でこのページを開き、ブックマーク（お気に入り）に追加します。<br>
          手軽ですが、画面の上下にブラウザのバーが表示されます。</p>
        </div>
        <div class="way">
          <h3>② アプリとして使う（ホーム画面に追加）おすすめ</h3>
          <p><b>iPhone：</b>Safari で開き、画面下の共有ボタン（□に↑）→「ホーム画面に追加」<br>
          <b>Android：</b>Chrome で開き、右上の︙ →「ホーム画面に追加」<br>
          ホーム画面のアイコンからすぐ開け、画面を広く使えます。電波がない所でも開けます。</p>
        </div>
        <p class="warn">⚠ ①と②では、保存される台本が別々になります（iPhone の仕組みです）。どちらかに決めて使い、台本はそちらで読み込んでください。</p>
      </details>`;
  }

  async function importFile(file) {
    if (!file) return;
    const overlay = $('#busy');
    overlay.hidden = false;
    try {
      const parsed = await ScriptParser.parseFile(file);
      const script = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        createdAt: Date.now(),
        lines: parsed.lines,
        characters: parsed.characters,
        settings: {},
      };
      await save(script);
      if (!script.characters.length) toast('セリフを見分けられませんでした。「台本の確認・修正」で直せます');
      location.hash = `#/s/${script.id}`;
    } catch (e) {
      console.error(e);
      alert('読み込めませんでした。\n' + e.message);
    } finally {
      overlay.hidden = true;
    }
  }

  // ---------- 練習の設定 ----------

  function segmented(name, options, value) {
    return `<div class="seg" data-name="${name}">${options.map(([v, label]) =>
      `<button type="button" data-value="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  }

  function voiceFor(script, name) {
    const s = settingsOf(script);
    const conf = s.voices[name] || {};
    const list = Speech.voices();
    let uri = conf.uri;
    let pitch = conf.pitch;
    if (name === '__direction') {
      return { voiceURI: uri || (list[0] && list[0].voiceURI), pitch: pitch || 1, rate: s.rate * 1.05 };
    }
    const idx = Math.max(0, script.characters.indexOf(name));
    const type = VOICE_TYPES[conf.type];
    if (type) {
      // タイプに合う性別の声を選ぶ。無ければ今ある声の高さを変えて近づける
      if (!uri) {
        const matches = list.filter(v => Speech.genderOf(v) === type.gender);
        const pick = matches.length ? matches : list;
        if (pick.length) uri = pick[idx % pick.length].voiceURI;
      }
      const v = list.find(x => x.voiceURI === uri);
      const gender = v ? Speech.genderOf(v) : null;
      let p = type.pitch;
      const child = conf.type.startsWith('child');
      if (type.gender === 'm' && gender === 'f' && !child) p *= 0.7;
      if (type.gender === 'f' && gender === 'm') p *= 1.3;
      return { voiceURI: uri, pitch: Math.min(2, p), rate: s.rate * type.rate };
    }
    if (!uri && list.length) uri = list[idx % list.length].voiceURI;
    if (!pitch) pitch = PITCHES[idx % PITCHES.length];
    return { voiceURI: uri, pitch, rate: s.rate };
  }

  function maxPage(script) {
    return script.lines.reduce((m, l) => Math.max(m, l.page || 0), 0);
  }

  function shortText(l) {
    const t = l.text.length > 18 ? l.text.slice(0, 18) + '…' : l.text;
    return (l.page ? `p.${l.page} ` : '') + (l.speakers.length ? l.speakers.join('・') + '：' : '') + t;
  }

  // 設定から、練習を始める行と止める行（この行の手前で止まる）を決める
  function computeRange(script) {
    const s = settingsOf(script);
    const lines = script.lines;
    const byId = id => lines.findIndex(l => l.id === id);
    let start = 0;
    if (s.startKind === 'resume') start = s.position || 0;
    else if (s.startKind === 'scene') start = byId(s.startScene);
    else if (s.startKind === 'marker') start = byId(s.startMarker);
    else if (s.startKind === 'page') start = lines.findIndex(l => (l.page || 0) >= s.startPage);
    start = Math.max(0, Math.min(start, lines.length - 1));

    const after = pred => { const i = lines.findIndex((l, j) => j > start && pred(l)); return i < 0 ? lines.length : i; };
    let stop = lines.length;
    if (s.endKind === 'scene') stop = after(l => l.type === 'scene');
    else if (s.endKind === 'marker') stop = after(l => l.marker);
    else if (s.endKind === 'page') stop = after(l => (l.page || 0) > s.endPage);
    return { start, stop };
  }

  function renderSetup(script, fromPlay) {
    const s = settingsOf(script);
    if (fromPlay) setHeader('設定', `#/s/${script.id}/play`, null, '練習に戻る');
    else setHeader(script.title, '#/');
    const counts = {};
    for (const l of script.lines) if (l.type === 'speech') for (const c of l.speakers) counts[c] = (counts[c] || 0) + 1;
    const voices = Speech.voices();
    const scenes = script.lines.filter(l => l.type === 'scene');
    const markers = script.lines.filter(l => l.marker);
    const pages = maxPage(script);
    const pos = Math.min(s.position, script.lines.length - 1);
    const posLine = script.lines[pos];
    // 選べなくなった項目（マーカーを全部外した等）は「最初から」に戻す
    const available = { top: true, resume: pos > 0, scene: scenes.length > 0, page: pages > 1, marker: markers.length > 0 };
    if (!available[s.startKind]) s.startKind = 'top';
    if (!{ end: true, scene: available.scene, marker: available.marker, page: available.page }[s.endKind]) s.endKind = 'end';
    if (!scenes.some(l => l.id === s.startScene)) s.startScene = scenes[0] && scenes[0].id;
    if (!markers.some(l => l.id === s.startMarker)) s.startMarker = markers[0] && markers[0].id;

    view.innerHTML = `
      <section class="setup">
        <h2>あなたの役 <small>（複数選べます）</small></h2>
        <div class="chips">
          ${script.characters.map(c => `<button type="button" class="chip ${s.myChars.includes(c) ? 'on' : ''}" data-char="${esc(c)}">${esc(c)}<small>${counts[c] || 0}</small></button>`).join('') || '<p class="hint">役が見つかりません。下の「台本の確認・修正」で直してください。</p>'}
        </div>
        <div class="merge-row">
          ${script.characters.length ? '<button type="button" class="btn small" id="merge-name">役名をまとめる・変える</button>' : ''}
          ${undoButtonHtml(script)}
        </div>

        <h2>ト書き</h2>
        ${segmented('readDirections', [[true, '読む'], [false, '飛ばす']], s.readDirections)}

        <h2>あなたのセリフ</h2>
        ${segmented('readMine', [[true, '読み上げる'], [false, '読み上げない']], s.readMine)}

        <div class="sub" id="advance-box" ${s.readMine ? 'hidden' : ''}>
          <h3>あなたのセリフの後、どう進む？</h3>
          ${segmented('advance', [['mic', '声で判断して自動'], ['time', '時間で自動'], ['button', 'ボタンで進む']], s.advance)}
          <p class="hint" data-for="mic">マイクであなたの声を聞き、言い終わって少し静かになったら次のセリフに進みます。</p>
          <p class="hint" data-for="time">セリフの長さから時間を計算して、待ってから次に進みます。</p>
          <p class="hint" data-for="button">言い終わったら「次へ」ボタンを押します。</p>
          <label class="range" data-for="mic">言い終わりを待つ長さ <output>${s.silenceSec.toFixed(1)}秒</output>
            <input type="range" min="0.6" max="4" step="0.1" value="${s.silenceSec}" data-setting="silenceSec" data-unit="秒"></label>
          <label class="range" data-for="time">待ち時間の長さ <output>${s.timeFactor.toFixed(1)}倍</output>
            <input type="range" min="0.5" max="3" step="0.1" value="${s.timeFactor}" data-setting="timeFactor" data-unit="倍"></label>

          <h3>あなたのセリフの表示</h3>
          ${segmented('showMine', [[true, '表示する'], [false, '隠す（暗記用）']], s.showMine)}
        </div>

        <h2>読み上げの速さ</h2>
        <label class="range">速さ <output>${s.rate.toFixed(1)}倍</output>
          <input type="range" min="0.6" max="1.6" step="0.1" value="${s.rate}" data-setting="rate" data-unit="倍"></label>

        <details class="voices">
          <summary>声の設定（役ごと）</summary>
          <p class="hint">この端末で使える日本語の声: ${voices.length ? esc(voices.map(v => v.name).join('、')) : 'なし'}</p>
          <details class="voice-help">
            <summary>声の種類を増やすには</summary>
            <p><b>iPhone・iPad</b><br>
            「設定」→「アクセシビリティ」→「読み上げコンテンツ」→「声」→「日本語」と進み、Otoya（男性）・Hattori（男性）・O-ren（女性）などをダウンロードします。「拡張」「高品質」と書かれた声は、より自然です。<br>
            ダウンロード後、このアプリを一度完全に閉じてから開き直してください。</p>
            <p><b>Android</b><br>
            「設定」→「ユーザー補助」→「テキスト読み上げの出力」から、日本語の音声データを追加できます（機種によって名前が違います）。</p>
            <p>声が1種類しかなくても、「声のタイプ」で高さと速さを変えて演じ分けます。</p>
          </details>
          ${['__direction', ...script.characters].map(c => {
            const conf = s.voices[c] || {};
            const typeSel = c === '__direction' ? '' :
              `<select data-k="type"><option value="">タイプおまかせ</option>${Object.entries(VOICE_TYPES).map(([k, t]) => `<option value="${k}" ${conf.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select>`;
            return `<div class="voice-row" data-char="${esc(c)}">
              <span class="vname">${c === '__direction' ? 'ト書き' : esc(c)}</span>
              ${typeSel}
              <select data-k="uri"><option value="">声おまかせ</option>${voices.map(v => `<option value="${esc(v.voiceURI)}" ${conf.uri === v.voiceURI ? 'selected' : ''}>${esc(v.name)}${Speech.genderOf(v) === 'm' ? '（男性）' : Speech.genderOf(v) === 'f' ? '（女性）' : ''}</option>`).join('')}</select>
              <button type="button" class="btn small test">試聴</button>
            </div>`;
          }).join('')}
        </details>

        <h2>練習する範囲</h2>
        <div class="range-box">
          <label class="field">始める場所
            <select id="start-kind" class="full">
              <option value="top">最初から</option>
              ${available.resume ? `<option value="resume">続きから（${esc(shortText(posLine))}）</option>` : ''}
              ${available.scene ? '<option value="scene">場面を選ぶ</option>' : ''}
              ${available.page ? '<option value="page">ページを指定</option>' : ''}
              ${available.marker ? '<option value="marker">🔖 マーカーから</option>' : ''}
            </select></label>
          <select id="start-scene" class="full" data-start="scene">
            ${scenes.map(l => `<option value="${l.id}" ${l.id === s.startScene ? 'selected' : ''}>${esc(l.text)}${l.page ? `（p.${l.page}）` : ''}</option>`).join('')}
          </select>
          <label class="page-input" data-start="page"><input type="number" id="start-page" inputmode="numeric" min="1" max="${pages}" value="${Math.min(s.startPage, pages) || 1}"> ページ目から（全${pages}ページ）</label>
          <select id="start-marker" class="full" data-start="marker">
            ${markers.map(l => `<option value="${l.id}" ${l.id === s.startMarker ? 'selected' : ''}>🔖 ${esc(shortText(l))}</option>`).join('')}
          </select>

          <label class="field">終わる場所
            <select id="end-kind" class="full">
              <option value="end">最後まで</option>
              ${available.scene ? '<option value="scene">その場面の終わりまで</option>' : ''}
              ${available.marker ? '<option value="marker">次の 🔖 マーカーの手前まで</option>' : ''}
              ${available.page ? '<option value="page">ページを指定</option>' : ''}
            </select></label>
          <label class="page-input" data-end="page"><input type="number" id="end-page" inputmode="numeric" min="1" max="${pages}" value="${Math.min(s.endPage, pages) || 1}"> ページ目の終わりまで</label>
          <p class="hint">終わる場所まで来ると止まります。▶ を押すと、同じ範囲をもう一度練習できます。</p>
          ${markers.length ? '' : '<p class="hint">🔖 練習画面の右下のボタンで、好きな行にマーカーを付けられます。</p>'}
          ${!pages && /\.pdf$/i.test(script.fileName || '') ? '<p class="hint">ページで指定するには、この台本をもう一度読み込んでください。</p>' : ''}
        </div>

        <button type="button" class="btn primary big" id="go">▶ 練習を始める</button>

        <div class="links">
          <a href="#/s/${script.id}/edit" class="btn">台本の確認・修正</a>
          <button type="button" class="btn" id="rename">名前を変える</button>
          <button type="button" class="btn danger" id="delete">この台本を削除</button>
        </div>
      </section>`;

    const updateVisibility = () => {
      $('#advance-box').hidden = s.readMine;
      view.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== s.advance; });
    };
    updateVisibility();

    const rerender = () => renderSetup(script, fromPlay);
    const merge = $('#merge-name');
    if (merge) merge.addEventListener('click', () => openRenameDialog(script, rerender));
    const undo = $('#undo-rename');
    if (undo) undo.addEventListener('click', () => undoRename(script, rerender));

    view.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      const c = b.dataset.char;
      s.myChars = s.myChars.includes(c) ? s.myChars.filter(x => x !== c) : [...s.myChars, c];
      b.classList.toggle('on');
      save(script);
    }));

    view.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const raw = b.dataset.value;
      s[seg.dataset.name] = raw === 'true' ? true : raw === 'false' ? false : raw;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      updateVisibility();
      save(script);
    }));

    view.querySelectorAll('input[data-setting]').forEach(inp => inp.addEventListener('input', () => {
      s[inp.dataset.setting] = parseFloat(inp.value);
      inp.previousElementSibling.textContent = parseFloat(inp.value).toFixed(1) + inp.dataset.unit;
      saveSoon(script);
    }));

    view.querySelectorAll('.voice-row').forEach(row => {
      const c = row.dataset.char;
      row.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
        const conf = s.voices[c] = s.voices[c] || {};
        conf[sel.dataset.k] = sel.value;
        if (sel.dataset.k === 'type') conf.pitch = null; // 以前の「高さ」設定より、タイプを優先する
        save(script);
      }));
      row.querySelector('.test').addEventListener('click', () => {
        Speech.cancel();
        const sample = c === '__direction' ? 'ト書きはこの声で読みます。' :
          (script.lines.find(l => l.type === 'speech' && l.speakers.includes(c)) || { text: 'よろしくお願いします。' }).text;
        Speech.speak(sample, voiceFor(script, c));
      });
    });

    const startKind = $('#start-kind'), endKind = $('#end-kind');
    startKind.value = s.startKind;
    endKind.value = s.endKind;
    const syncRange = () => {
      view.querySelectorAll('[data-start]').forEach(el => { el.hidden = el.dataset.start !== startKind.value; });
      view.querySelectorAll('[data-end]').forEach(el => { el.hidden = el.dataset.end !== endKind.value; });
    };
    syncRange();
    const readRange = () => {
      s.startKind = startKind.value;
      s.endKind = endKind.value;
      if (scenes.length) s.startScene = parseInt($('#start-scene').value, 10);
      if (markers.length) s.startMarker = parseInt($('#start-marker').value, 10);
      const clampPage = v => Math.max(1, Math.min(pages || 1, parseInt(v, 10) || 1));
      s.startPage = clampPage($('#start-page').value);
      s.endPage = clampPage($('#end-page').value);
      syncRange();
      save(script);
    };
    ['#start-kind', '#end-kind', '#start-scene', '#start-marker', '#start-page', '#end-page']
      .forEach(sel => $(sel).addEventListener('change', readRange));

    $('#go').addEventListener('click', () => {
      Speech.unlock();
      readRange();
      const { start, stop } = computeRange(script);
      if (stop <= start) { alert('終わる場所が、始める場所より前になっています'); return; }
      s.position = start;
      s.rangeStart = start;
      s.stopAt = stop < script.lines.length ? stop : null;
      save(script).then(() => { location.hash = `#/s/${script.id}/play`; });
    });

    $('#rename').addEventListener('click', () => {
      const name = prompt('台本の名前', script.title);
      if (name && name.trim()) { script.title = name.trim(); save(script).then(route); }
    });

    $('#delete').addEventListener('click', async () => {
      if (!confirm(`「${script.title}」をこの端末から削除します。よろしいですか？`)) return;
      await ScriptDB.remove(script.id);
      location.hash = '#/';
    });
  }

  // ---------- 台本の確認・修正 ----------

  function lineHtml(l, i, cls = '') {
    const who = l.type === 'speech' ? `<span class="who">${esc(l.speakers.join('・'))}</span>` : '';
    return `<li class="line t-${l.type} ${l.marker ? 'marked' : ''} ${cls}" data-i="${i}">${who}<span class="text">${esc(l.text)}</span></li>`;
  }

  // 台本の全行。ページが変わる所に区切りを入れる
  function linesHtml(script, clsOf = () => '') {
    let page = null;
    return script.lines.map((l, i) => {
      const sep = l.page && l.page !== page ? `<li class="page-sep">${l.page}ページ</li>` : '';
      page = l.page || page;
      return sep + lineHtml(l, i, clsOf(l, i));
    }).join('');
  }

  function renderEdit(script) {
    setHeader('台本の確認・修正', `#/s/${script.id}`);
    view.innerHTML = `
      <section class="edit">
        <p class="hint">行をタップすると、種類（セリフ／ト書き）や役名、文章を直せます。読み方がおかしい言葉は、ひらがなに書き換えると正しく読まれます。</p>
        <div class="row-btns">
          <button type="button" class="btn" id="merge-name">役名をまとめる・変える</button>
          ${undoButtonHtml(script)}
        </div>
        <ol class="lines editable">${linesHtml(script)}</ol>
      </section>`;

    $('#merge-name').addEventListener('click', () => openRenameDialog(script, () => renderEdit(script)));
    const undo = $('#undo-rename');
    if (undo) undo.addEventListener('click', () => undoRename(script, () => renderEdit(script)));
    view.querySelector('.lines').addEventListener('click', e => {
      const li = e.target.closest('li[data-i]');
      if (li) openLineDialog(script, parseInt(li.dataset.i, 10));
    });
  }

  function openDialog(html) {
    const dlg = $('#dialog');
    dlg.innerHTML = `<form method="dialog" class="dialog-body">${html}</form>`;
    dlg.showModal();
    return dlg;
  }

  function openRenameDialog(script, onDone) {
    const dlg = openDialog(`
      <h3>役名をまとめる・変える</h3>
      <label>変える前の役名
        <select name="from">${script.characters.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label>新しい役名（既にある役名にするとまとめられます）
        <input name="to" list="char-list" required></label>
      <datalist id="char-list">${script.characters.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="dialog-btns"><button value="cancel" class="btn" formnovalidate>やめる</button><button value="ok" class="btn primary">変更する</button></div>`);
    dlg.onclose = async () => {
      if (dlg.returnValue !== 'ok') return;
      const from = dlg.querySelector('[name=from]').value;
      const to = dlg.querySelector('[name=to]').value.trim();
      if (!to || from === to) return;
      const s = settingsOf(script);
      // 元に戻せるよう、変更前の状態を残しておく（最大10回分）
      const history = script.renameHistory = script.renameHistory || [];
      history.push({
        from, to,
        speakers: Object.fromEntries(script.lines.filter(l => l.speakers.length).map(l => [l.id, l.speakers.slice()])),
        myChars: s.myChars.slice(),
        voices: JSON.parse(JSON.stringify(s.voices)),
      });
      if (history.length > 10) history.shift();

      for (const l of script.lines) {
        l.speakers = [...new Set(l.speakers.map(c => c === from ? to : c))];
      }
      if (s.myChars.includes(from)) s.myChars = [...new Set(s.myChars.map(c => c === from ? to : c))];
      if (s.voices[from] && !s.voices[to]) s.voices[to] = s.voices[from];
      delete s.voices[from];
      refreshCharacters(script);
      await save(script);
      const y = window.scrollY;
      onDone();
      window.scrollTo(0, y);
      toast(`「${from}」を「${to}」に変えました`, { label: '元に戻す', run: () => undoRename(script, onDone) });
    };
  }

  async function undoRename(script, onDone) {
    const last = (script.renameHistory || []).pop();
    if (!last) return;
    for (const l of script.lines) {
      if (last.speakers[l.id]) l.speakers = last.speakers[l.id];
    }
    const s = settingsOf(script);
    s.myChars = last.myChars;
    s.voices = last.voices;
    refreshCharacters(script);
    await save(script);
    const y = window.scrollY;
    onDone();
    window.scrollTo(0, y);
    toast(`「${last.to}」への変更を取り消しました`);
  }

  function undoButtonHtml(script) {
    const last = (script.renameHistory || []).slice(-1)[0];
    return last ? `<button type="button" class="btn small" id="undo-rename">↩ 元に戻す（${esc(last.from)}→${esc(last.to)}）</button>` : '';
  }

  function openLineDialog(script, i) {
    const l = script.lines[i];
    const dlg = openDialog(`
      <h3>${i + 1}行目</h3>
      <label>種類
        <select name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${l.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="speaker-field">役名（2人以上は「・」で区切る）
        <input name="speakers" list="char-list2" value="${esc(l.speakers.join('・'))}"></label>
      <datalist id="char-list2">${script.characters.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label>文章<textarea name="text" rows="5">${esc(l.text)}</textarea></label>
      <label class="check"><input type="checkbox" name="marker" ${l.marker ? 'checked' : ''}> 🔖 マーカーを付ける（ここから練習を始められます）</label>
      <div class="dialog-btns">
        ${i > 0 ? '<button value="join" class="btn small">前の行とつなげる</button>' : ''}
        <button value="del" class="btn small danger">この行を削除</button>
      </div>
      <div class="dialog-btns"><button value="cancel" class="btn" formnovalidate>やめる</button><button value="ok" class="btn primary">保存</button></div>`);
    const typeSel = dlg.querySelector('[name=type]');
    const spField = dlg.querySelector('.speaker-field');
    const sync = () => { spField.hidden = typeSel.value !== 'speech'; };
    typeSel.addEventListener('change', sync);
    sync();

    dlg.onclose = async () => {
      const v = dlg.returnValue;
      if (v === 'cancel' || !v) return;
      const keepScroll = window.scrollY;
      if (v === 'del') {
        if (!confirm('この行を削除しますか？')) return;
        script.lines.splice(i, 1);
      } else if (v === 'join') {
        script.lines[i - 1].text += dlg.querySelector('[name=text]').value.trim();
        script.lines.splice(i, 1);
      } else {
        l.type = typeSel.value;
        l.text = dlg.querySelector('[name=text]').value.trim();
        l.marker = dlg.querySelector('[name=marker]').checked;
        l.speakers = l.type === 'speech'
          ? dlg.querySelector('[name=speakers]').value.split(/[・、,，]/).map(x => x.trim()).filter(Boolean)
          : [];
        if (l.type === 'speech' && !l.speakers.length) { alert('役名を入れてください'); return; }
      }
      refreshCharacters(script);
      await save(script);
      renderEdit(script);
      window.scrollTo(0, keepScroll);
    };
  }

  // ---------- 練習 ----------

  let wakeLock = null;
  async function requestWakeLock() {
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* 対応していない端末 */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  function isMine(script, line) {
    const s = settingsOf(script);
    return line.type === 'speech' && line.speakers.some(c => s.myChars.includes(c));
  }

  // 練習モードで実際に扱う行か
  function isPlayable(script, line) {
    const s = settingsOf(script);
    if (line.type === 'skip') return false;
    if (line.type === 'direction' || line.type === 'scene') return s.readDirections;
    return true;
  }

  function renderPlay(script) {
    const s = settingsOf(script);
    setHeader(script.title, '#/', `#/s/${script.id}`);
    // 練習の途中で設定を開いたら、戻ったときに続きから始められるようにする
    $('#settings').onclick = e => {
      e.preventDefault();
      if (player) s.position = player.idx;
      s.startKind = s.position > 0 ? 'resume' : 'top';
      save(script).then(() => { location.hash = `#/s/${script.id}/settings`; });
    };
    document.body.classList.add('playing');

    view.innerHTML = `
      <section class="play">
        <ol class="lines script">${linesHtml(script, (l, i) => {
          const mine = isMine(script, l);
          // 隠すのは、これから言うセリフ（今の位置から後ろ）だけ
          const conceal = mine && !s.showMine && i >= (s.position || 0);
          return [mine ? 'mine' : '', conceal ? 'concealed' : '', isPlayable(script, l) ? '' : 'muted'].join(' ');
        })}</ol>
      </section>
      <div class="turn" id="turn" hidden>
        <div class="turn-head">あなたの番<span id="turn-who"></span></div>
        <div class="turn-text" id="turn-text"></div>
        <button type="button" class="btn small" id="reveal" hidden>セリフを見る</button>
        <div class="meter"><div id="meter-bar"></div></div>
        <div class="turn-status" id="turn-status"></div>
        <button type="button" class="btn primary turn-next" id="turn-next">✓ 言えた！次へ</button>
      </div>
      <nav class="controls">
        <button type="button" id="prev"><span class="ic">⏮</span><span class="lb">前へ</span></button>
        <button type="button" id="toggle" class="main"><span class="ic">▶</span><span class="lb">再生</span></button>
        <button type="button" id="next"><span class="ic">⏭</span><span class="lb">次へ</span></button>
        <button type="button" id="marker"><span class="ic">🔖</span><span class="lb">印</span></button>
      </nav>`;

    if (!s.myChars.length && !s.readMine) toast('あなたの役が選ばれていないので、全員のセリフを読み上げます');

    player = new Player(script);
    $('#toggle').addEventListener('click', () => player.playing ? player.pause() : player.play());
    $('#next').addEventListener('click', () => player.next());
    $('#turn-next').addEventListener('click', () => player.next());
    $('#prev').addEventListener('click', () => player.prev());
    $('#marker').addEventListener('click', () => player.toggleMarker());
    $('#reveal').addEventListener('click', () => { $('#turn-text').classList.remove('concealed'); $('#reveal').hidden = true; });
    view.querySelector('.script').addEventListener('click', e => {
      const li = e.target.closest('li[data-i]');
      if (li) player.jump(parseInt(li.dataset.i, 10));
    });

    player.highlight(player.idx);
    player.play();
  }

  class Player {
    constructor(script) {
      this.script = script;
      this.s = settingsOf(script);
      this.idx = Math.min(this.s.position || 0, script.lines.length - 1);
      // 練習する範囲（stopAt の行の手前で止まる）
      this.rangeStart = this.s.rangeStart || 0;
      this.stopAt = this.s.stopAt || script.lines.length;
      if (this.idx < this.rangeStart || this.idx >= this.stopAt) this.clearRange();
      this.markRange();
      if (this.stopAt < script.lines.length) {
        toast(`${shortText(script.lines[this.rangeStart])} から練習します`);
      }
      this.playing = false;
      this.run = 0;          // 再生のたびに増やし、古い処理を止める
      this.waitDone = null;  // 自分の番で待っているときの「次へ」
      this.signal = null;
    }

    play() {
      Speech.unlock();
      requestWakeLock();
      this.playing = true;
      $('#toggle').innerHTML = '<span class="ic">⏸</span><span class="lb">停止</span>';
      this.loop(++this.run);
    }

    pause() {
      this.playing = false;
      this.interrupt();
      $('#toggle').innerHTML = '<span class="ic">▶</span><span class="lb">再生</span>';
      this.hideTurn();
    }

    stop() {
      this.pause();
      releaseWakeLock();
    }

    interrupt() {
      this.run++;
      Speech.cancel();
      if (this.signal) this.signal.cancelled = true;
      if (this.waitDone) { const f = this.waitDone; this.waitDone = null; f(); }
    }

    next() {
      if (this.waitDone && this.playing) { // 自分の番 → 次のセリフへ
        const f = this.waitDone; this.waitDone = null;
        if (this.signal) this.signal.cancelled = true;
        f();
        return;
      }
      this.jump(this.findPlayable(this.idx + 1, 1));
    }

    prev() {
      this.jump(this.findPlayable(this.idx - 1, -1));
    }

    clearRange() {
      this.rangeStart = 0;
      this.stopAt = this.script.lines.length;
      this.s.rangeStart = 0;
      this.s.stopAt = null;
    }

    // 範囲の外の行を薄く表示する
    markRange() {
      view.querySelectorAll('.line[data-i]').forEach(el => {
        const i = parseInt(el.dataset.i, 10);
        el.classList.toggle('out', i < this.rangeStart || i >= this.stopAt);
      });
    }

    toggleMarker() {
      const line = this.script.lines[this.idx];
      line.marker = !line.marker;
      const el = view.querySelector(`.line[data-i="${this.idx}"]`);
      if (el) el.classList.toggle('marked', line.marker);
      ScriptDB.put(this.script);
      toast(line.marker ? '🔖 マーカーを付けました。設定画面の「始める場所」で選べます' : 'マーカーを外しました');
    }

    // 隠すモードのとき、i 行目より前の自分のセリフは表示し、i 行目から後ろは隠す
    concealFrom(i) {
      if (this.s.showMine) return;
      view.querySelectorAll('.line.mine').forEach(el => {
        el.classList.toggle('concealed', parseInt(el.dataset.i, 10) >= i);
      });
    }

    jump(i) {
      if (i < 0 || i >= this.script.lines.length) return;
      if (i < this.rangeStart || i >= this.stopAt) { this.clearRange(); this.markRange(); }
      this.concealFrom(i);
      const wasPlaying = this.playing;
      this.interrupt();
      this.hideTurn();
      this.idx = i;
      this.highlight(i);
      if (wasPlaying) {
        this.playing = true;
        setTimeout(() => this.loop(++this.run), 80); // 読み上げの停止を待ってから
      }
    }

    findPlayable(i, dir) {
      const lines = this.script.lines;
      while (i >= 0 && i < lines.length && !isPlayable(this.script, lines[i])) i += dir;
      return Math.max(0, Math.min(lines.length - 1, i));
    }

    highlight(i) {
      view.querySelectorAll('.line.current').forEach(el => el.classList.remove('current'));
      const el = view.querySelector(`.line[data-i="${i}"]`);
      if (el) {
        el.classList.add('current');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      this.s.position = i;
      saveSoon(this.script);
    }

    async loop(run) {
      const lines = this.script.lines;
      while (this.playing && run === this.run) {
        if (this.idx >= this.stopAt && this.stopAt < lines.length) {
          // 範囲の終わり: 範囲の最初に戻しておき、▶ でもう一度練習できるようにする
          this.pause();
          this.idx = this.rangeStart;
          this.concealFrom(this.idx);
          this.highlight(this.idx);
          toast('範囲の終わりまで来ました。▶ でもう一度練習できます');
          return;
        }
        if (this.idx >= lines.length) {
          this.pause();
          this.idx = 0;
          this.s.position = 0;
          saveSoon(this.script);
          toast('最後まで終わりました');
          return;
        }
        const line = lines[this.idx];
        if (isPlayable(this.script, line)) {
          this.highlight(this.idx);
          await this.perform(line, run);
          if (run !== this.run) return;
        }
        this.idx++;
      }
    }

    async perform(line, run) {
      const s = this.s;
      if (line.type !== 'speech') {
        await Speech.speak(line.text, voiceFor(this.script, '__direction'));
        return;
      }
      // セリフの中の（カッコ書き）はト書きなので、ト書きを飛ばすときは読まない
      const text = s.readDirections ? line.text : line.text.replace(/[（(][^）)]*[）)]/g, '');
      const mine = isMine(this.script, line);
      if (!mine || s.readMine || !s.myChars.length) {
        await Speech.speak(text, voiceFor(this.script, line.speakers[0]));
        return;
      }
      await this.myTurn(line, text, run);
    }

    // 自分のセリフ: 言い終わるのを待つ
    async myTurn(line, text, run) {
      const s = this.s;
      this.showTurn(line);
      const done = new Promise(resolve => { this.waitDone = resolve; });
      const signal = this.signal = { cancelled: false };
      const status = $('#turn-status');
      const bar = $('#meter-bar');
      const chars = Speech.cleanForSpeech(text).length;
      const estimate = Math.max(1.5, chars * 0.17 / s.rate) * s.timeFactor + 0.8;

      $('#turn-next').textContent = s.advance === 'button' ? '✓ 言えた！次へ' : '次へ進む';
      if (s.advance === 'button') {
        status.textContent = 'セリフを言い終わったら、下のボタンを押してください';
        bar.parentElement.hidden = true;
      } else if (s.advance === 'time') {
        bar.parentElement.hidden = false;
        status.textContent = `${estimate.toFixed(1)}秒後に自動で進みます`;
        bar.style.transition = 'none';
        bar.style.width = '0%';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          bar.style.transition = `width ${estimate}s linear`;
          bar.style.width = '100%';
        }));
        setTimeout(() => { if (!signal.cancelled && this.waitDone) this.next(); }, estimate * 1000);
      } else {
        bar.parentElement.hidden = false;
        bar.style.transition = 'width 0.05s';
        status.textContent = 'どうぞ。言い終わると自動で進みます';
        Speech.waitForSpeechEnd({
          silenceSec: s.silenceSec,
          maxWaitSec: Math.max(20, estimate * 4),
          signal,
          onLevel: (lv, state) => {
            bar.style.width = Math.round(lv * 100) + '%';
            bar.classList.toggle('hot', state === 'speaking');
          },
        }).then(reason => {
          if (signal.cancelled || !this.waitDone) return;
          if (reason === 'timeout') status.textContent = '声が聞こえなかったので進みます';
          this.next();
        }).catch(err => {
          console.error(err);
          status.textContent = 'マイクが使えません。下のボタンを押して進んでください';
          bar.parentElement.hidden = true;
          toast('マイクの使用が許可されていません。端末の設定を確認してください');
        });
      }
      await done;
      if (run === this.run) {
        this.hideTurn();
        // 言い終わったセリフは表示して、合っていたか確かめられるようにする
        const el = view.querySelector(`.line[data-i="${this.idx}"]`);
        if (el) el.classList.remove('concealed');
      }
    }

    showTurn(line) {
      $('#turn').hidden = false;
      $('#turn-who').textContent = `（${line.speakers.join('・')}）`;
      const t = $('#turn-text');
      t.textContent = line.text;
      t.classList.toggle('concealed', !this.s.showMine);
      $('#reveal').hidden = this.s.showMine;
      document.body.classList.add('my-turn');
    }

    hideTurn() {
      const turn = $('#turn');
      if (turn) turn.hidden = true;
      document.body.classList.remove('my-turn');
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && player && player.playing) requestWakeLock();
  });

  // 電波がない所でも開けるようにする
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        // 画面に戻ってきたときにも新しい版がないか確認する
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
    // 新しい版が届いたら読み込み直す（練習中はお知らせだけ）
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (player && player.playing) toast('新しい版があります。練習が終わったら開き直してください');
      else location.reload();
    });
  }

  if (!Speech.supported) toast('このブラウザは読み上げに対応していません');
  route();
})();
