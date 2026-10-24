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
  };
  const PITCHES = [1.0, 0.8, 1.2, 0.9, 1.1, 0.75, 1.3];
  const TYPE_LABEL = { speech: 'セリフ', direction: 'ト書き', scene: '場面', skip: '読まない' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function settingsOf(script) {
    script.settings = Object.assign({}, DEFAULTS, script.settings || {});
    return script.settings;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  function setHeader(title, backHash) {
    titleEl.textContent = title;
    backBtn.hidden = !backHash;
    backBtn.onclick = () => { location.hash = backHash; };
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
        return renderSetup(script);
      }
      return renderHome();
    } catch (e) {
      console.error(e);
      view.innerHTML = `<p class="error">エラーが起きました: ${esc(e.message)}</p>`;
    }
  }
  window.addEventListener('hashchange', route);

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
      </section>`;
    $('#file').addEventListener('change', e => importFile(e.target.files[0]));
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
    if (!uri && list.length) uri = list[idx % list.length].voiceURI;
    if (!pitch) pitch = PITCHES[idx % PITCHES.length];
    return { voiceURI: uri, pitch, rate: s.rate };
  }

  function sceneOptions(script) {
    return script.lines.map((l, i) => [l, i]).filter(([l]) => l.type === 'scene');
  }

  function renderSetup(script) {
    const s = settingsOf(script);
    setHeader(script.title, '#/');
    const counts = {};
    for (const l of script.lines) if (l.type === 'speech') for (const c of l.speakers) counts[c] = (counts[c] || 0) + 1;
    const voices = Speech.voices();
    const scenes = sceneOptions(script);
    const pos = Math.min(s.position, script.lines.length - 1);

    view.innerHTML = `
      <section class="setup">
        <h2>あなたの役 <small>（複数選べます）</small></h2>
        <div class="chips">
          ${script.characters.map(c => `<button type="button" class="chip ${s.myChars.includes(c) ? 'on' : ''}" data-char="${esc(c)}">${esc(c)}<small>${counts[c] || 0}</small></button>`).join('') || '<p class="hint">役が見つかりません。下の「台本の確認・修正」で直してください。</p>'}
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
          ${voices.length ? '' : '<p class="hint">この端末で日本語の声が見つかりません。端末の設定で日本語の音声を追加してください。</p>'}
          ${['__direction', ...script.characters].map(c => {
            const conf = s.voices[c] || {};
            return `<div class="voice-row" data-char="${esc(c)}">
              <span class="vname">${c === '__direction' ? 'ト書き' : esc(c)}</span>
              <select data-k="uri"><option value="">おまかせ</option>${voices.map(v => `<option value="${esc(v.voiceURI)}" ${conf.uri === v.voiceURI ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
              <select data-k="pitch"><option value="">高さおまかせ</option>${[[0.7, '低い'], [0.85, 'やや低い'], [1, 'ふつう'], [1.15, 'やや高い'], [1.3, '高い']].map(([v, l]) => `<option value="${v}" ${conf.pitch === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <button type="button" class="btn small test">試聴</button>
            </div>`;
          }).join('')}
        </details>

        <h2>どこから始める？</h2>
        <select id="start" class="full">
          <option value="0">最初から</option>
          ${pos > 0 ? `<option value="${pos}" selected>続きから（${pos + 1}行目）</option>` : ''}
          ${scenes.map(([l, i]) => `<option value="${i}">${esc(l.text)}</option>`).join('')}
        </select>

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
        conf[sel.dataset.k] = sel.dataset.k === 'pitch' ? (sel.value ? parseFloat(sel.value) : null) : sel.value;
        save(script);
      }));
      row.querySelector('.test').addEventListener('click', () => {
        Speech.cancel();
        const sample = c === '__direction' ? 'ト書きはこの声で読みます。' :
          (script.lines.find(l => l.type === 'speech' && l.speakers.includes(c)) || { text: 'よろしくお願いします。' }).text;
        Speech.speak(sample, voiceFor(script, c));
      });
    });

    $('#go').addEventListener('click', () => {
      Speech.unlock();
      s.position = parseInt($('#start').value, 10) || 0;
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
    return `<li class="line t-${l.type} ${cls}" data-i="${i}">${who}<span class="text">${esc(l.text)}</span></li>`;
  }

  function renderEdit(script) {
    setHeader('台本の確認・修正', `#/s/${script.id}`);
    view.innerHTML = `
      <section class="edit">
        <p class="hint">行をタップすると、種類（セリフ／ト書き）や役名、文章を直せます。読み方がおかしい言葉は、ひらがなに書き換えると正しく読まれます。</p>
        <div class="row-btns">
          <button type="button" class="btn" id="merge-name">役名をまとめる・変える</button>
        </div>
        <ol class="lines editable">${script.lines.map((l, i) => lineHtml(l, i)).join('')}</ol>
      </section>`;

    $('#merge-name').addEventListener('click', () => openRenameDialog(script));
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

  function openRenameDialog(script) {
    const dlg = openDialog(`
      <h3>役名をまとめる・変える</h3>
      <label>変える前の役名
        <select name="from">${script.characters.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label>新しい役名（既にある役名にするとまとめられます）
        <input name="to" list="char-list" required></label>
      <datalist id="char-list">${script.characters.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="dialog-btns"><button value="cancel" class="btn">やめる</button><button value="ok" class="btn primary">変更する</button></div>`);
    dlg.onclose = async () => {
      if (dlg.returnValue !== 'ok') return;
      const from = dlg.querySelector('[name=from]').value;
      const to = dlg.querySelector('[name=to]').value.trim();
      if (!to || from === to) return;
      for (const l of script.lines) {
        l.speakers = [...new Set(l.speakers.map(s => s === from ? to : s))];
      }
      const s = settingsOf(script);
      if (s.myChars.includes(from)) s.myChars = [...new Set(s.myChars.map(c => c === from ? to : c))];
      refreshCharacters(script);
      await save(script);
      toast(`「${from}」を「${to}」に変えました`);
      renderEdit(script);
    };
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
      <div class="dialog-btns">
        ${i > 0 ? '<button value="join" class="btn small">前の行とつなげる</button>' : ''}
        <button value="del" class="btn small danger">この行を削除</button>
      </div>
      <div class="dialog-btns"><button value="cancel" class="btn">やめる</button><button value="ok" class="btn primary">保存</button></div>`);
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
    setHeader(script.title, `#/s/${script.id}`);
    document.body.classList.add('playing');

    view.innerHTML = `
      <section class="play">
        <ol class="lines script">${script.lines.map((l, i) => {
          const mine = isMine(script, l);
          const cls = [mine ? 'mine' : '', mine && !s.showMine ? 'concealed' : '', isPlayable(script, l) ? '' : 'muted'].join(' ');
          return lineHtml(l, i, cls);
        }).join('')}</ol>
      </section>
      <div class="turn" id="turn" hidden>
        <div class="turn-head">あなたの番<span id="turn-who"></span></div>
        <div class="turn-text" id="turn-text"></div>
        <button type="button" class="btn small" id="reveal" hidden>セリフを見る</button>
        <div class="meter"><div id="meter-bar"></div></div>
        <div class="turn-status" id="turn-status"></div>
      </div>
      <nav class="controls">
        <button type="button" id="prev" aria-label="前へ">⏮</button>
        <button type="button" id="toggle" class="main" aria-label="再生">▶</button>
        <button type="button" id="next" aria-label="次へ">⏭</button>
      </nav>`;

    if (!s.myChars.length && !s.readMine) toast('あなたの役が選ばれていないので、全員のセリフを読み上げます');

    player = new Player(script);
    $('#toggle').addEventListener('click', () => player.playing ? player.pause() : player.play());
    $('#next').addEventListener('click', () => player.next());
    $('#prev').addEventListener('click', () => player.prev());
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
      this.playing = false;
      this.run = 0;          // 再生のたびに増やし、古い処理を止める
      this.waitDone = null;  // 自分の番で待っているときの「次へ」
      this.signal = null;
    }

    play() {
      Speech.unlock();
      requestWakeLock();
      this.playing = true;
      $('#toggle').textContent = '⏸';
      this.loop(++this.run);
    }

    pause() {
      this.playing = false;
      this.interrupt();
      $('#toggle').textContent = '▶';
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

    jump(i) {
      if (i < 0 || i >= this.script.lines.length) return;
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

      if (s.advance === 'button') {
        status.textContent = '言い終わったら ⏭ を押してください';
        bar.parentElement.hidden = true;
      } else if (s.advance === 'time') {
        bar.parentElement.hidden = false;
        status.textContent = `${estimate.toFixed(1)}秒後に進みます（⏭ ですぐ進む）`;
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
          status.textContent = 'マイクが使えません。⏭ を押して進んでください';
          bar.parentElement.hidden = true;
          toast('マイクの使用が許可されていません。端末の設定を確認してください');
        });
      }
      await done;
      if (run === this.run) this.hideTurn();
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!Speech.supported) toast('このブラウザは読み上げに対応していません');
  route();
})();
