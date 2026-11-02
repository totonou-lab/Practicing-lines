'use strict';

// ===================== 定数 =====================
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'];

const EQUIPMENT = [
  ['free', 'フリーウェイト（ダンベル・バーベル・ベンチ）'],
  ['machine', 'マシン'],
  ['cable', 'ケーブルマシン'],
  ['smith', 'スミスマシン・パワーラック'],
];

const MEAL_TYPES = [['breakfast', '朝食'], ['lunch', '昼食'], ['dinner', '夕食'], ['snack', '間食']];

const BODY_FIELDS = [
  ['weight', '体重', 'kg'],
  ['fatPct', '体脂肪率', '%'],
  ['skeletalMuscle', '骨格筋量', 'kg'],
  ['muscle', '筋肉量', 'kg'],
  ['fatMass', '体脂肪量', 'kg'],
  ['bmr', '基礎代謝', 'kcal'],
  ['visceral', '内臓脂肪レベル', ''],
  ['water', '体水分量', 'kg'],
  ['score', 'InBody点数', '点'],
];

const CARDIO_TYPES = ['ランニング（屋外）', 'ウォーキング（屋外）', 'トレッドミル（ウォーキング・ランニング）', 'エアロバイク', 'クロストレーナー', 'ステアクライマー（階段）', 'ローイング', 'その他'];
const LB = 2.20462;
const SESSION_MODES = [['weights', 'ウェイトトレーニングのみ'], ['both', 'ウェイトトレーニング＋有酸素運動'], ['cardio', '有酸素運動のみ']];
function sessionText() {
  const st = S.settings, w = num(st.weightMin) || 60, c = num(st.cardioMin) || 20;
  if (st.sessionMode === 'cardio') return `有酸素運動のみ・1回${c}分`;
  if (st.sessionMode === 'both') return `1回${w + c}分（ウェイトトレーニング${w}分＋有酸素運動${c}分）`;
  return `ウェイトトレーニングのみ・1回${w}分（ウォームアップ込み）`;
}
const BIKES = [['normal', '普通の自転車（ママチャリ・クロスバイク）'], ['assist', '電動アシスト自転車'], ['road', 'ロードバイク']];

const SOURCES = { inbody: 'InBody', tanita: '家庭の体重計', manual: '手入力', health: 'ヘルスケア' };

const MODES = [
  ['cut', '引き締め（脂肪を落とす）'],
  ['maintain', '維持しながら筋肉をつける'],
  ['bulk', '増量（筋肉を大きくする）'],
];

const ACTIVITY = [
  [1.2, 'ほとんど座っている（デスクワーク中心）'],
  [1.375, '軽く動く＋週2〜3回トレーニング'],
  [1.55, 'よく動く＋週3〜5回トレーニング'],
  [1.725, '立ち仕事・肉体労働＋トレーニング'],
];

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: MODELS[0],
  profile: { sex: '', birthYear: '', height: '', activity: 1.375 },
  goals: ['腹筋を割る', '健康維持'],
  // 期限: months=基準日から◯ヶ月後 / date=日付で指定
  targetMode: 'months',
  targetMonths: 3,
  targetBase: '',
  targetDate: '',
  mode: 'cut',
  daysPerWeek: 3,
  equipment: ['free', 'machine', 'cable', 'smith'],
  unit: 'kg',
  override: { kcal: '', protein: '' },
  target: null, // { weight, fatPct, skeletalMuscle, reason, steps, source, date, startWeight, startFat }
  bike: 'normal',
  shortcutName: 'bodymake用にコピー',
  weekBalance: true, // 1週間のバランスで毎日の目標カロリーを自動調整する
  pinned: ['ab4'], // 毎回必ず入れる種目（最初はアブローラー）
  routes: [],
  sessionMode: 'weights', // weights=ウェイトのみ / both=ウェイト＋有酸素 / cardio=有酸素のみ
  weightMin: 60,
  cardioMin: 20,
};

// ===================== 保存（iPhoneの中のデータベース） =====================
const S = { settings: null, body: [], meals: [], favorites: [], plan: null, workouts: [], analyses: [], rides: [], today: null, events: [], habits: [], myFoods: [] };
let dbPromise;

function db() {
  return dbPromise ||= new Promise((ok, ng) => {
    const r = indexedDB.open('bodymake', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
}
async function idbGet(k) {
  const d = await db();
  return new Promise((ok, ng) => {
    const r = d.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
}
async function idbSet(k, v) {
  const d = await db();
  return new Promise((ok, ng) => {
    const t = d.transaction('kv', 'readwrite');
    t.objectStore('kv').put(v, k);
    t.oncomplete = () => ok();
    t.onerror = () => ng(t.error);
  });
}
async function save(...keys) {
  for (const k of keys) await idbSet(k, S[k]);
}
function mergeSettings(saved = {}) {
  const d = structuredClone(DEFAULT_SETTINGS);
  return { ...d, ...saved, profile: { ...d.profile, ...saved.profile }, override: { ...d.override, ...saved.override } };
}
async function loadAll() {
  for (const k of Object.keys(S)) {
    const v = await idbGet(k);
    if (v !== undefined) S[k] = v;
  }
  const saved = S.settings;
  // 期限の決め方が無い古い設定は、今までの日付のまま使う
  if (saved && !saved.targetMode) saved.targetMode = 'date';
  S.settings = mergeSettings(saved || {});
  if (!S.settings.targetBase) S.settings.targetBase = ymd(); // 初めて開いた日を基準にする
}

// ===================== 小さな道具 =====================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = v => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const firstNum = v => { const m = String(v ?? '').match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const r0 = n => (n == null ? '–' : Math.round(n));
const r1 = n => (n == null ? '–' : Math.round(n * 10) / 10);
const sum = (arr, k) => arr.reduce((a, x) => a + (num(x[k]) || 0), 0);

// 重さは内部ではいつもkgで持ち、表示と入力のときだけlbに換算する
const toUnit = (kg, u) => (kg == null ? null : u === 'lb' ? Math.round(kg * LB * 10) / 10 : Math.round(kg * 100) / 100);
const fromUnit = (v, u) => (v == null ? null : u === 'lb' ? Math.round((v / LB) * 1000) / 1000 : v);

// iPhoneの日付欄は見た目が崩れやすいので、表示は自前・選ぶときだけ本物の日付欄を使う
function dateBox(attrs, value) {
  return `<span class="datebox"><span class="datebox-text">${value ? ymdText(value) : '日付を選ぶ'}</span><input type="date" ${attrs} value="${h(value)}"></span>`;
}
function ymdText(s) {
  const d = parseYmd(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
}

function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function jpDate(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
}
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function addMonths(s, n) {
  const d = parseYmd(s), day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return ymd(d);
}
// 期限の日付（◯ヶ月後なら基準日から計算）
function targetDate() {
  const st = S.settings;
  if (st.targetMode === 'months') return addMonths(st.targetBase || ymd(), num(st.targetMonths) || 3);
  return st.targetDate || addMonths(ymd(), 3);
}
function daysUntil(s) { return Math.round((parseYmd(s) - parseYmd(ymd())) / 86400000); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}
// 下の閉じるボタン：保存ボタンがある画面だけ「保存しない」と書く
function openSheet(title, html, closeLabel) {
  closeLabel ||= /data-act="\w*(Save|Done|Run|Import|Accept)\b/.test(html) ? '閉じる（保存しない）' : '閉じる';
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html + `<button class="btn block" data-act="closeSheet" style="margin-top:10px">${closeLabel}</button>`;
  $('#sheet').hidden = false;
  $('.sheet-panel').scrollTop = 0;
  document.body.classList.add('noscroll');
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
  document.body.classList.remove('noscroll');
  draft = null;
}
function busy(on, msg = 'AIが分析中…', est = 0) {
  $('#busy').hidden = !on;
  $('#busy-msg').textContent = msg;
  $('#busy-progress').hidden = !(on && est);
  clearInterval(busy.timer);
  if (!on || !est) return;
  const start = Date.now();
  const tick = () => {
    const t = (Date.now() - start) / 1000;
    // 予想時間までに90%、それを過ぎたらゆっくり99%に近づける
    const pct = t < est ? (t / est) * 90 : 90 + 9 * (1 - Math.exp(-(t - est) / est));
    $('#busy-fill').style.width = pct + '%';
    $('#busy-time').textContent = t < est
      ? `経過 ${Math.floor(t)}秒 ・ あと約${Math.ceil(est - t)}秒`
      : `経過 ${Math.floor(t)}秒 ・ 予想より時間がかかっています。もう少しお待ちください`;
  };
  tick();
  busy.timer = setInterval(tick, 250);
}

// ===================== 写真 =====================
function pickPhotos(multiple = false, accept = 'image/*') {
  return new Promise(ok => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.style.display = 'none';
    i.onchange = () => { ok([...i.files]); i.remove(); };
    document.body.appendChild(i);
    i.click();
  });
}
function loadImage(src) {
  return new Promise((ok, ng) => { const img = new Image(); img.onload = () => ok(img); img.onerror = ng; img.src = src; });
}
async function resizeImage(src, max, quality = 0.8) {
  const img = await loadImage(src);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
async function fileToJpeg(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try { return await resizeImage(url, max); } finally { URL.revokeObjectURL(url); }
}
const b64 = dataUrl => dataUrl.split(',')[1];

// 画面収録の動画から、一定間隔でコマを切り出す
async function videoFrames(file, maxFrames = 16, max = 1600) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise((ok, ng) => {
      v.onloadeddata = ok;
      v.onerror = () => ng(new Error('動画を読み込めませんでした'));
      v.load();
    });
    const dur = v.duration;
    const n = Math.min(maxFrames, Math.max(2, Math.ceil(dur / 1.2)));
    const s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    const frames = [];
    for (let i = 0; i < n; i++) {
      await new Promise(ok => { v.onseeked = ok; v.currentTime = (dur * (i + 0.5)) / n; });
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      frames.push(c.toDataURL('image/jpeg', 0.8));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}
// 写真・スクショ・画面収録をまとめてAIに送れる画像に変える
async function filesToImages(files, max = 1600, maxFrames = 16, cap = 20) {
  const out = [];
  for (const f of files) {
    if (f.type.startsWith('video/')) out.push(...await videoFrames(f, maxFrames, max));
    else out.push(await fileToJpeg(f, max));
  }
  return out.slice(0, cap);
}

// ===================== AI（Google Gemini） =====================
function parseJSON(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('AIの返事を読み取れませんでした');
  return JSON.parse(t.slice(a, b + 1));
}

async function gemini(prompt, images = [], signal) {
  const key = S.settings.apiKey.trim();
  if (!key) throw new Error('NO_KEY');
  const models = [S.settings.model, ...MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: prompt },
        ...images.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: b64(d) } })),
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  });
  let lastErr;
  for (const m of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal,
    });
    if (res.ok) {
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
      return parseJSON(text);
    }
    lastErr = new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    // モデルが無い・混雑・回数上限のときは次のモデルで再挑戦
    if (![404, 429, 500, 503].includes(res.status)) break;
  }
  throw lastErr;
}

function aiErrorMessage(e) {
  const m = String(e?.message || e);
  if (m === 'NO_KEY') return '設定画面で Gemini の「APIキー」を入れてください。';
  if (/^(400|401|403)/.test(m)) return 'APIキーが正しくないか、使えない状態のようです。設定画面で確認してください。';
  if (m.startsWith('429')) return '無料で使える回数の上限に達したようです。しばらく（翌日など）時間をおいてください。';
  if (/Failed to fetch|NetworkError|Load failed/.test(m)) return '通信できませんでした。電波を確認してください。';
  return 'AIの処理に失敗しました。\n' + m.slice(0, 150);
}

// かかる時間の予想: [基本の秒数, 画像1枚あたりの秒数]。実際の時間を覚えて補正する
const EST_DEFAULT = { meal: [15, 0], text: [10, 0], body: [12, 3], kmemo: [20, 4], analyze: [30, 6], plan: [50, 0], test: [5, 0] };
const AI_TIMEOUT = 300;
let aiCtrl = null;

function loadEst() {
  try { return JSON.parse(localStorage.getItem('bodymake-est')) || {}; } catch { return {}; }
}
function baseEst(kind, units) {
  const [base, per] = EST_DEFAULT[kind] || [20, 0];
  return base + per * units;
}
const estimateSec = (kind, units) => baseEst(kind, units) * (loadEst()[kind]?.ratio || 1);
function learnEst(kind, units, sec) {
  const all = loadEst();
  const ratio = sec / baseEst(kind, units);
  all[kind] = { ratio: all[kind] ? all[kind].ratio * 0.5 + ratio * 0.5 : ratio };
  try { localStorage.setItem('bodymake-est', JSON.stringify(all)); } catch {}
}

async function runAI(msg, fn, kind = '', units = 0) {
  const ctrl = new AbortController();
  aiCtrl = ctrl;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, AI_TIMEOUT * 1000);
  const start = Date.now();
  busy(true, msg, estimateSec(kind, units));
  try {
    const r = await fn(ctrl.signal);
    if (kind) learnEst(kind, units, (Date.now() - start) / 1000);
    return r;
  } catch (e) {
    if (e.name === 'AbortError') {
      if (timedOut) alert('5分たっても返事がなかったので止めました。\n画像の枚数を減らす（短めの動画にする）か、時間をおいて試してください。');
      else toast('中止しました');
    } else { console.error(e); alert(aiErrorMessage(e)); }
    return null;
  } finally {
    clearTimeout(timer);
    aiCtrl = null;
    busy(false);
  }
}

// ===================== 体のデータ・目標の計算 =====================
const sortedBody = () => [...S.body].sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
const latestBody = () => sortedBody().at(-1) || null;
const latestWith = field => sortedBody().reverse().find(b => num(b[field]) != null) || null;

function age() {
  const y = num(S.settings.profile.birthYear);
  return y ? new Date().getFullYear() - y : null;
}

function targets() {
  const st = S.settings, p = st.profile;
  const w = num(latestWith('weight')?.weight);
  const fat = num(latestWith('fatPct')?.fatPct);
  let bmr = num(latestWith('bmr')?.bmr), how = '体組成計の基礎代謝';
  if (!bmr && w && fat) { bmr = 370 + 21.6 * w * (1 - fat / 100); how = '体重と体脂肪率から計算'; }
  if (!bmr && w && num(p.height) && age() && p.sex) {
    bmr = 10 * w + 6.25 * num(p.height) - 5 * age() + (p.sex === 'male' ? 5 : -161);
    how = '体重・身長・年齢から計算';
  }
  if (!bmr || !w) return null;
  const tdee = bmr * (num(p.activity) || 1.375);
  let kcal = st.mode === 'cut' ? Math.max(tdee - 400, bmr) : st.mode === 'bulk' ? tdee + 250 : tdee;
  let protein = w * 2.0;
  if (num(st.override.kcal)) kcal = num(st.override.kcal);
  if (num(st.override.protein)) protein = num(st.override.protein);
  const fatG = (kcal * 0.25) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fatG * 9) / 4);
  return { bmr, tdee, kcal, protein, fat: fatG, carbs, how };
}

// ===================== 自転車での移動 =====================
// METs（運動の強さ）から計算。安静時の分（1MET）は1日の消費に入っているので差し引く
function rideKcal(km, min, bike) {
  const w = num(latestWith('weight')?.weight) || 65;
  const speed = num(min) ? km / (min / 60) : bike === 'road' ? 22 : 15;
  let met = speed < 16 ? 4.0 : speed < 19 ? 6.8 : speed < 22 ? 8.0 : 10.0;
  if (bike === 'assist') met = Math.max(2.5, met * 0.75);
  return Math.round((met - 1) * w * (km / speed));
}
const ridesOn = date => S.rides.filter(r => r.date === date);
const rideKcalOn = date => ridesOn(date).reduce((a, r) => a + r.kcal, 0);
// 有酸素運動は消費kcalが入っているもの（Apple Watchやマシンの表示）だけ足す
const cardioKcalOn = date => S.workouts.filter(w => w.date === date).reduce((a, w) => a + (w.cardio || []).reduce((b, c) => b + (num(c.kcal) || 0), 0), 0);
// その日の目標: 自転車と有酸素運動で使った分を炭水化物として上乗せ（週のバランス調整の前）
function baseTargetsOn(date) {
  const t = targets();
  if (!t) return null;
  const ride = rideKcalOn(date), cardio = cardioKcalOn(date), extra = ride + cardio;
  return { ...t, kcal: t.kcal + extra, carbs: t.carbs + extra / 4, ride, cardio, extra };
}
// ===================== 1週間の食事バランス =====================
// 会食の予定 1件のおおよその量: お店の1人前×食べる量＋お酒1杯150kcal
const eventKcalOn = date => (S.events || []).filter(e => e.date === date).reduce((a, e) => a + (num(e.kcal) || 0), 0);
const weekDays = () => Array.from({ length: 7 }, (_, i) => addDays(weekStartOf(ymd()), i));
function weekPlan() {
  const today = ymd(), days = weekDays();
  // これまで（今日より前で記録がある日）の「食べた量 − 目標」
  const pastDays = days.filter(d => d < today && mealsOn(d).length);
  const past = pastDays.reduce((a, d) => a + dayTotals(d).kcal - baseTargetsOn(d).kcal, 0);
  // これからの会食で、ふだんの夕ごはん（目標の約4割）より多くなる分
  const future = days.filter(d => d >= today);
  const evDays = future.filter(d => eventKcalOn(d));
  const evExcess = evDays.reduce((a, d) => a + Math.max(0, eventKcalOn(d) - baseTargetsOn(d).kcal * 0.4), 0);
  const normal = future.filter(d => !eventKcalOn(d));
  const raw = normal.length ? -(past + evExcess) / normal.length : 0;
  // 1日に減らすのは400kcalまで、増やすのは200kcalまで
  const per = Math.round(Math.max(-400, Math.min(200, raw)));
  return { days, pastDays, past, evDays, evExcess, normal, per, capped: Math.abs(raw - per) > 1 };
}
function targetsOn(date) {
  const t = baseTargetsOn(date);
  if (!t || !S.settings.weekBalance || date < ymd() || !weekDays().includes(date)) return t;
  const wp = weekPlan(), ev = eventKcalOn(date);
  let adj = Math.round(ev ? Math.max(0, ev - t.kcal * 0.4) : wp.per);
  if (!adj) return t;
  const kcal = Math.max(Math.round(t.bmr), t.kcal + adj);
  adj = kcal - t.kcal;
  // 増やす分は炭水化物に、減らす分は炭水化物6：脂質4で減らす（たんぱく質はそのまま）
  return { ...t, kcal, carbs: Math.max(0, adj > 0 ? t.carbs + adj / 4 : t.carbs + (adj * 0.6) / 4), fat: Math.max(0, adj > 0 ? t.fat : t.fat + (adj * 0.4) / 9), weekAdj: adj, eventDay: !!ev };
}
function weekReason(wp) {
  const r = [];
  if (wp.evDays.length) r.push(`${wp.evDays.map(d => jpDate(d)).join('・')}の会食に備えて`);
  if (wp.past > 100) r.push('食べすぎた分を少しずつ調整');
  if (wp.past < -100 && !wp.evDays.length) r.push('控えめだった分を少し戻して');
  return r.join('・');
}
function weekBalanceHtml(compact) {
  const base = baseTargetsOn(ymd());
  if (!base) return '';
  const wp = weekPlan(), today = targetsOn(ymd());
  const on = S.settings.weekBalance;
  const pastText = !wp.pastDays.length ? 'まだ記録なし' : Math.abs(wp.past) < 100 ? 'ちょうどいいペース' : wp.past > 0 ? `<b class="up">+${r0(wp.past)}kcal 食べすぎ</b>` : `<b class="down">${r0(wp.past)}kcal 控えめ</b>`;
  const adjText = today?.eventDay ? `🍻 今日は会食の日。目標を <b>+${r0(today.weekAdj)}kcal</b> にしています（${r0(today.kcal)}kcal）`
    : on && today?.weekAdj ? `今日の目標は いつもより <b>${today.weekAdj > 0 ? '+' : ''}${r0(today.weekAdj)}kcal</b>（${r0(today.kcal)}kcal）${weekReason(wp) ? `：${weekReason(wp)}` : ''}` : '';
  if (compact) return adjText || wp.evDays.length ? `<p class="small week-line">📅 ${adjText || `今週は${wp.evDays.map(d => jpDate(d)).join('・')}に会食の予定`}</p>` : '';
  const upcoming = (S.events || []).filter(e => e.date >= ymd()).sort((a, b) => a.date.localeCompare(b.date));
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(ymd(), -(i + 1))).filter(d => mealsOn(d).length);
  const avg = last30.length ? last30.reduce((a, d) => a + dayTotals(d).kcal, 0) / last30.length : 0;
  const over = last30.filter(d => dayTotals(d).kcal > baseTargetsOn(d).kcal * 1.1).length;
  return `<div class="card"><h3>📅 今週の食事バランス <span class="muted">${jpDate(wp.days[0])}〜${jpDate(wp.days[6])}</span></h3>
    <p class="small">これまで（記録した${wp.pastDays.length}日）：${pastText}</p>
    ${adjText ? `<div class="hint small">${adjText}</div>` : ''}
    ${on && wp.capped ? '<p class="muted">無理な食事制限にならないよう、1日に減らすのは400kcalまでにしています。全部を今週で取り戻さなくて大丈夫です。</p>' : ''}
    <h4>会食・飲み会の予定</h4>
    ${upcoming.length ? `<ul class="list">${upcoming.map(e => `<li><div class="grow small"><b>${jpDate(e.date)}</b> ${h(e.label)}<div class="muted">約${r0(e.kcal)}kcal</div></div>
      <button class="icon-btn" data-act="eventDelete" data-id="${e.id}" aria-label="予定を削除">✕</button></li>`).join('')}</ul>` : '<p class="muted">予定はありません。</p>'}
    <button class="btn sm" data-act="eventNew">＋ 会食・飲み会の予定を入れる</button>
    <label class="check" style="margin-top:8px"><input type="checkbox" data-set="weekBalance" ${on ? 'checked' : ''}>今週のバランスで、毎日の目標カロリーを自動で調整する</label>
    ${last30.length >= 3 ? `<h4>直近30日</h4><p class="small">記録した${last30.length}日の平均 <b>${r0(avg)}kcal</b>（目標 ${r0(base.kcal)}kcal）・目標を1割以上こえた日 ${over}日</p>` : ''}
    <button class="btn block" data-act="foodAnalyzeAI" style="margin-top:8px">🤖 AIに1週間・1か月の食事を分析してもらう</button>
  </div>`;
}
function eventSheet() {
  draft = { shop: 'izakaya', rough: 1, drinks: 2 };
  openSheet('会食・飲み会の予定', `
    <label class="field">日付${dateBox('id="ev-date"', addDays(ymd(), 1))}</label>
    <label class="field">メモ（任意）<input id="ev-label" placeholder="例：会社の飲み会"></label>
    <label class="field">お店の種類<select id="ev-shop" data-in="eventCalc">${SHOPS.map(x => `<option value="${x[0]}">${x[1]}</option>`).join('')}</select></label>
    <div class="grid2">
      <label class="field">食べる量<select id="ev-amount" data-in="eventCalc">${ROUGH_AMOUNTS.map(([v, l]) => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">お酒（杯）<select id="ev-drinks" data-in="eventCalc">${[0, 1, 2, 3, 4, 5, 6, 8].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}杯</option>`).join('')}</select></label>
    </div>
    <div class="hint small" id="ev-kcal"></div>
    <button class="btn primary block" data-act="eventSave">予定を入れる</button>`);
  INPUT.eventCalc();
}
const eventKcalCalc = () => {
  const shop = SHOPS.find(x => x[0] === $('#ev-shop').value);
  return Math.round(shop[2] * num($('#ev-amount').value) + num($('#ev-drinks').value) * 150);
};
function foodAnalyzePrompt() {
  const days = Array.from({ length: 30 }, (_, i) => addDays(ymd(), -i)).reverse().filter(d => mealsOn(d).length);
  const lines = days.map(d => { const t = dayTotals(d), g = baseTargetsOn(d); return `${d}（${'日月火水木金土'[parseYmd(d).getDay()]}） ${r0(t.kcal)}kcal P${r0(t.protein)} F${r0(t.fat)} C${r0(t.carbs)} / 目標${r0(g.kcal)}kcal P${r0(g.protein)}`; });
  const ws = sortedBody().filter(b => num(b.weight) != null && b.date >= addDays(ymd(), -30)).map(b => `${b.date} ${b.weight}kg${b.fatPct ? ' ' + b.fatPct + '%' : ''}`);
  const evs = (S.events || []).filter(e => e.date >= ymd()).map(e => `${e.date} ${e.label}（約${e.kcal}kcal）`);
  return `あなたは日本の管理栄養士です。利用者の直近30日の食事記録を分析し、1週間・1か月のトータルのバランスで、続けやすい調整方法を提案してください。
【なりたい体・目標】
${goalsText()}
【毎日の食事（記録した日のみ）】
${lines.join('\n') || 'なし'}
【体重の変化】
${ws.join('\n') || 'なし'}
【これからの会食の予定】
${evs.join('\n') || 'なし'}
- 曜日ごとの傾向（週末に多い など）、たんぱく質・脂質の傾向、記録が抜けがちな日も見てください
- 食べすぎた日を責めず、1週間の合計で整える考え方で。極端な制限はすすめないでください
- 会食の予定がある場合は、その前後の日の過ごし方も具体的に
次の形のJSONだけを返してください:
{"summary":"全体のまとめ（2〜3文）","patterns":["見つかった傾向"],"advice":["具体的なアドバイス"],"nextWeek":"これからの1週間の過ごし方（会食があればその前後も）"}`;
}

function rideWeekText() {
  const from = addDays(ymd(), -6);
  const rs = S.rides.filter(r => r.date >= from);
  if (!rs.length) return '記録なし';
  return `直近7日で ${r1(rs.reduce((a, r) => a + r.km, 0))}km・約${rs.reduce((a, r) => a + r.kcal, 0)}kcal（${new Set(rs.map(r => r.date)).size}日）`;
}

// 腹筋が見えてくる体脂肪率の目安までの距離
function absGuide() {
  const sex = S.settings.profile.sex;
  const b = latestWith('fatPct');
  if (!sex || !b || !num(b.weight)) return null;
  const custom = num(S.settings.target?.fatPct);
  const goalPct = custom || (sex === 'male' ? 11 : 18);
  const w = num(b.weight), pct = num(b.fatPct);
  const lean = w * (1 - pct / 100);
  // 筋肉の量はそのままで、脂肪だけ落としたときの体重
  const goalW = lean / (1 - goalPct / 100);
  const toLose = Math.max(0, w - goalW);
  const weeks = Math.max(1, daysUntil(targetDate()) / 7);
  const perWeek = toLose / weeks;
  return { goalPct, pct, w, goalW, toLose, perWeek, weeks, safe: perWeek <= w * 0.007, source: b.source, custom: !!custom };
}

// 目標の数値: 自分で決めた（またはAIの提案を採用した）値 → 無ければ計算の目安
function targetValues() {
  const t = S.settings.target;
  if (t && (num(t.weight) || num(t.fatPct))) return { ...t, weight: num(t.weight), fatPct: num(t.fatPct), skeletalMuscle: num(t.skeletalMuscle) };
  const g = absGuide();
  return g ? { weight: Math.round(g.goalW * 10) / 10, fatPct: g.goalPct, source: 'calc' } : null;
}
function targetHtml() {
  const tv = targetValues();
  if (!tv) return '<p class="muted">性別と体脂肪率が入ると、目標の体重・体脂肪率を出せます。</p>';
  const nowW = num(latestWith('weight')?.weight), nowF = num(latestWith('fatPct')?.fatPct);
  const diff = (now, goal, u) => (now != null && goal != null ? `<span class="${goal - now < 0 ? 'down' : 'up'}">${goal - now < 0 ? '−' : '+'}${r1(Math.abs(goal - now))}${u}</span>` : '');
  // 進み具合: 目標を決めたときの値から、どれだけ近づいたか
  const st = S.settings.target;
  const prog = (start, now, goal) => (start != null && now != null && goal != null && start !== goal ? Math.max(0, Math.min(100, ((start - now) / (start - goal)) * 100)) : null);
  const pw = prog(num(st?.startWeight), nowW, tv.weight), pf = prog(num(st?.startFat), nowF, tv.fatPct);
  return `<div class="target-box">
    <div class="grid2">
      <div class="stat"><span>目標の体重</span><b>${tv.weight != null ? r1(tv.weight) + '<small>kg</small>' : '-'}</b><span>今 ${r1(nowW)}kg ${diff(nowW, tv.weight, 'kg')}</span></div>
      <div class="stat"><span>目標の体脂肪率</span><b>${tv.fatPct != null ? r1(tv.fatPct) + '<small>%</small>' : '-'}</b><span>今 ${r1(nowF)}% ${diff(nowF, tv.fatPct, '%')}</span></div>
    </div>
    ${tv.skeletalMuscle ? `<p class="small" style="text-align:center;margin:6px 0 0">骨格筋量の目標 <b>${r1(tv.skeletalMuscle)}kg</b>（今 ${r1(num(latestWith('skeletalMuscle')?.skeletalMuscle))}kg）</p>` : ''}
    ${pf != null ? `<div class="bar"><div class="bar-top"><span>体脂肪率の進み具合</span><span>${r0(pf)}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${pf}%"></div></div></div>` : ''}
    ${pw != null && pf == null ? `<div class="bar"><div class="bar-top"><span>体重の進み具合</span><span>${r0(pw)}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${pw}%"></div></div></div>` : ''}
    <p class="muted" style="margin:6px 0 0">${tv.source === 'ai' ? `🤖 AIの提案（${jpDate(tv.date)}）` : tv.source === 'manual' ? '自分で決めた目標' : '計算の目安（筋肉の量はそのままで、腹筋が見える体脂肪率まで落とした場合）'}</p>
  </div>`;
}
function targetPrompt() {
  return `あなたは経験豊富なパーソナルトレーナー兼管理栄養士です。利用者の「なりたい体」の言葉と体のデータから、期限までの現実的な数値目標を提案してください。
【利用者の情報】
${profileText()}
【なりたい体・目標】
${goalsText()}
【週のトレーニング】週${S.settings.daysPerWeek}回
- 体脂肪率は、測った機械（InBody／家庭の体重計）の値を基準にしてください。
- 筋肉を増やす目標がある場合は、骨格筋量の増加も見込んで目標体重を決めてください（体脂肪を落としながら筋肉を増やすペースは、一般の人で月0.2〜0.5kg程度）。
- 体重の減らし方は週に体重の0.5〜0.7%以内の、無理のないペースにしてください。期限までに難しい場合は正直にそう書き、届く範囲の目標にしてください。
次の形のJSONだけを返してください:
{"weight":目標体重kg,"fatPct":目標体脂肪率%,"skeletalMuscle":目標骨格筋量kgまたはnull,"weeklyPace":"週あたりのペース（例: 週0.3kg）","reason":"そう考えた理由（2〜3文）","steps":["途中の目安（例: 1か月後 71.5kg・13%）"]}`;
}

function profileText() {
  const p = S.settings.profile, b = latestBody();
  const lines = [];
  lines.push(`性別: ${p.sex === 'male' ? '男性' : p.sex === 'female' ? '女性' : '未設定'} / 年齢: ${age() ?? '未設定'} / 身長: ${p.height || '未設定'}cm`);
  if (b) {
    const vals = BODY_FIELDS.filter(([k]) => num(b[k]) != null).map(([k, l, u]) => `${l} ${b[k]}${u}`).join('、');
    lines.push(`最新の測定（${b.date}・${SOURCES[b.source] || ''}）: ${vals}`);
    const seg = b.extra && Object.keys(b.extra).length ? JSON.stringify(b.extra) : '';
    if (seg) lines.push(`その他の測定値: ${seg}`);
  }
  const ib = sortedBody().reverse().find(x => x.source === 'inbody');
  if (ib && ib !== b) {
    const vals = BODY_FIELDS.filter(([k]) => num(ib[k]) != null).map(([k, l, u]) => `${l} ${ib[k]}${u}`).join('、');
    lines.push(`直近のInBody（${ib.date}）: ${vals}${ib.extra && Object.keys(ib.extra).length ? ' / ' + JSON.stringify(ib.extra) : ''}`);
  }
  const first = sortedBody()[0];
  if (first && b && first !== b) lines.push(`最初の記録（${first.date}）: 体重 ${first.weight ?? '-'}kg、体脂肪率 ${first.fatPct ?? '-'}%`);
  return lines.join('\n');
}
function goalsText() {
  const tv = S.settings.target;
  if (tv && (num(tv.weight) || num(tv.fatPct))) return goalsTextBase() + `\n数値の目標: 体重${tv.weight ?? '-'}kg・体脂肪率${tv.fatPct ?? '-'}%${tv.skeletalMuscle ? `・骨格筋量${tv.skeletalMuscle}kg` : ''}`;
  return goalsTextBase();
}
function goalsTextBase() {
  const st = S.settings;
  return `${st.goals.map(g => '- ' + g).join('\n')}\n期限: ${targetDate()}（あと${daysUntil(targetDate())}日）\n今の方針: ${MODES.find(m => m[0] === st.mode)?.[1]}`;
}
const equipmentText = () => S.settings.equipment.map(k => EQUIPMENT.find(e => e[0] === k)?.[1]).filter(Boolean).join('、') || '自重のみ';

// ===================== 食事 =====================
const mealsOn = date => S.meals.filter(m => m.date === date).sort((a, b) => (a.created || 0) - (b.created || 0));
function dayTotals(date) {
  const ms = mealsOn(date);
  return { kcal: sum(ms, 'kcal'), protein: sum(ms, 'protein'), fat: sum(ms, 'fat'), carbs: sum(ms, 'carbs') };
}
function defaultMealType() {
  const hr = new Date().getHours();
  return hr < 10 ? 'breakfast' : hr < 15 ? 'lunch' : hr < 18 ? 'snack' : 'dinner';
}
function recalcMeal(m) {
  for (const k of ['kcal', 'protein', 'fat', 'carbs']) m[k] = Math.round(sum(m.items, k) * 10) / 10;
  return m;
}

const MEAL_JSON = '{"name":"食事全体の短い名前","items":[{"name":"料理・食品名","amount":"推定量（例: 茶碗1杯 150g）","kcal":数値,"protein":数値,"fat":数値,"carbs":数値}],"note":"推定の根拠や注意点を1〜2文"}';

function mealPhotoPrompt(hint) {
  return `あなたは日本の管理栄養士です。写真に写っている料理・食品をすべて特定し、見た目から量を推定して、カロリー(kcal)・たんぱく質(g)・脂質(g)・炭水化物(g)を見積もってください。
日本食品標準成分表や、よくある市販品・コンビニ・外食チェーンの値を参考にしてください。パッケージの栄養成分表示が写っていれば、その値を優先してください。
数値は「その人が1食で食べる分」です。
補足情報: ${hint || 'なし'}
次の形のJSONだけを返してください（数値は数字のみ）:
${MEAL_JSON}`;
}
function mealTextPrompt(text) {
  return `あなたは日本の管理栄養士です。次の食事内容から、料理・食品ごとにカロリー(kcal)・たんぱく質(g)・脂質(g)・炭水化物(g)を見積もってください。量の指定が無いものは日本の一般的な1人前とします。市販品・チェーン店の商品名があれば、その公表値に近い値にしてください。
食事内容: ${text}
次の形のJSONだけを返してください（数値は数字のみ）:
${MEAL_JSON}`;
}
// ===================== 食べ物の辞書（AIを使わずに探す） =====================
// 辞書（foods.js）は「文字で記録」を初めて開いたときに読み込む
let foodsReady;
function loadFoods() {
  return (foodsReady ||= new Promise((ok, ng) => {
    const sc = document.createElement('script');
    sc.src = 'foods.js';
    sc.onload = () => ok(window.FOOD_DB);
    sc.onerror = () => { foodsReady = null; ng(new Error('辞書を読み込めませんでした')); };
    document.head.appendChild(sc);
  }));
}
// ふだんの言い方 → 成分表の言い方
const FOOD_ALIAS = [
  ['鶏肉', 'にわとり'], ['鶏', 'にわとり'], ['鳥', 'にわとり'], ['とり', 'にわとり'], ['豚', 'ぶた'], ['ぽーく', 'ぶた'], ['牛', 'うし'], ['ぎゅう', 'うし'], ['びーふ', 'うし'],
  ['胸肉', 'むね'], ['むね肉', 'むね'], ['胸', 'むね'], ['もも肉', 'もも'], ['腿', 'もも'], ['挽肉', 'ひき肉'], ['ひきにく', 'ひき肉'],
  ['玉子', '鶏卵'], ['たまご', '鶏卵'], ['卵', '鶏卵'], ['ご飯', 'めし'], ['ごはん', 'めし'], ['白米', '精白米'], ['米', 'こめ'],
  ['鮭', 'さけ'], ['しゃけ', 'さけ'], ['さーもん', 'さけ'], ['鯖', 'さば'], ['鮪', 'まぐろ'], ['つな', 'まぐろ 缶詰'], ['鯵', 'あじ'], ['鰤', 'ぶり'], ['海老', 'えび'], ['烏賊', 'いか'], ['蛸', 'たこ'],
  ['人参', 'にんじん'], ['玉ねぎ', 'たまねぎ'], ['玉葱', 'たまねぎ'], ['大根', 'だいこん'], ['胡瓜', 'きゅうり'], ['茄子', 'なす'], ['南瓜', 'かぼちゃ'], ['椎茸', 'しいたけ'], ['生姜', 'しょうが'], ['葱', 'ねぎ'],
  ['林檎', 'りんご'], ['蜜柑', 'みかん'], ['苺', 'いちご'], ['葡萄', 'ぶどう'], ['蕎麦', 'そば'], ['饂飩', 'うどん'], ['ぱすた', 'すぱげってぃ'],
  ['牛乳', '普通牛乳'], ['豆腐', '豆腐'], ['納豆', '納豆'], ['味噌', 'みそ'], ['醤油', 'しょうゆ'], ['胡麻', 'ごま'],
];
// 全角→半角、カタカナ→ひらがな、記号と空白を除く
const kana = t => String(t || '').normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・（）()「」、,]/g, '');
const aliasTokens = q => {
  let t = String(q || '').normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (const [a, b] of FOOD_ALIAS) t = t.split(a).join(` ${kana(b)} `);
  return t.split(/[\s・、,]+/).map(kana).filter(Boolean);
};
let foodIndex = null;
function buildFoodIndex(db) {
  const mk = (kind, name, amount, unit, v, al = '') => ({ kind, name, amount, unit, kcal: v[0], protein: v[1], fat: v[2], carbs: v[3], key: kana(name + al), alKey: kana(al) });
  foodIndex = [
    ...db.dishes.map(x => mk('dish', x[0], x[2], 'x', x.slice(3), x[1])),
    ...db.basics.map(x => mk('basic', x[0], x[2], 'x', x.slice(3), x[1])),
    ...db.mext.map(x => mk('ing', x[0], '100g', 'g', x.slice(1))),
  ];
}
// 自分で記録したもの（お気に入り・AIに聞いて覚えたもの）も一緒に探す
const myFoodEntries = () => [
  ...S.favorites.map(f => ({ kind: 'fav', name: f.name, amount: '1回分', unit: 'x', kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs, items: f.items, key: kana(f.name) })),
  ...(S.myFoods || []).map(f => ({ kind: 'my', name: f.name, amount: f.amount || '1人前', unit: 'x', kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs, key: kana(f.name) })),
];
const FOOD_KIND = { fav: '⭐ お気に入り', my: '📒 覚えた料理', dish: '🍱 料理', basic: '🥚 食材', ing: '🥬 食材（成分表）' };
function searchFoods(q) {
  const whole = kana(q), toks = aliasTokens(q);
  if (!whole) return [];
  const rank = { fav: 0, my: 0, dish: 1, basic: 1, ing: 3 };
  const out = [];
  for (const f of [...myFoodEntries(), ...(foodIndex || [])]) {
    let sc;
    if (f.key.startsWith(whole)) sc = 0;
    else if (f.key.includes(whole)) sc = 1;
    else if (toks.length && toks.every(t => f.key.includes(t))) sc = 2;
    else continue;
    out.push({ f, sc: sc + rank[f.kind] * 2 + (f.kind === 'ing' ? f.name.length / 100 : 0) });
  }
  const seen = new Set();
  return out.sort((a, b) => a.sc - b.sc).map(x => x.f).filter(f => !seen.has(f.kind + f.name) && seen.add(f.kind + f.name)).slice(0, 15);
}
// AIに聞いた料理を覚えておき、次からはすぐ出す
async function learnFoods(items) {
  const list = (S.myFoods || []).filter(f => !items.some(i => kana(i.name) === kana(f.name)));
  for (const i of items) if (i.name && i.kcal > 0) list.unshift({ name: i.name, amount: i.amount || '', kcal: i.kcal, protein: i.protein, fat: i.fat, carbs: i.carbs });
  S.myFoods = list.slice(0, 500);
  await save('myFoods');
}
// 選んだものの量: 料理は「何人前（倍）」、成分表の食材は「g」
const foodQty = f => (f.unit === 'g' ? 100 : 1);
function foodItem(sel) {
  const r = sel.unit === 'g' ? sel.q / 100 : sel.q;
  const v = k => Math.round(sel[k] * r * 10) / 10;
  const amount = sel.unit === 'g' ? `${sel.q}g` : sel.q === 1 ? sel.amount : `${sel.amount}×${sel.q}`;
  return { name: sel.name, amount, kcal: v('kcal'), protein: v('protein'), fat: v('fat'), carbs: v('carbs') };
}
function foodSheet() {
  draft = { sel: [], res: [] };
  openSheet('✏️ 文字で記録', `
    <div class="fs-top"><input id="fs-q" type="search" data-in="foodSearch" placeholder="料理名・食材名（例：からあげ、鶏むね）" autocomplete="off"></div>
    <div id="fs-res" class="fs-res"><p class="muted">打つとすぐ候補が出ます。AIは使わないので待ち時間はありません。</p></div>
    <div id="fs-sel"></div>
    <button class="btn block" data-act="foodAI" style="margin-top:10px">🤖 見つからないときはAIに聞く</button>
    <p class="muted" style="margin-top:10px">食材の値：文部科学省「日本食品標準成分表2020年版（八訂）」を加工して作成。料理の値は一般的な1人前の目安です。</p>`);
  renderFoodSel();
  loadFoods().then(db => { if (!foodIndex) buildFoodIndex(db); if ($('#fs-q')?.value) INPUT.foodSearch($('#fs-q')); })
    .catch(e => { $('#fs-res').innerHTML = `<p class="muted">${h(e.message)}。AIに聞いてください。</p>`; });
  setTimeout(() => $('#fs-q')?.focus(), 50);
}
function renderFoodRes() {
  const q = $('#fs-q').value.trim();
  $('#fs-res').innerHTML = !q ? '' : draft.res.length ? `<ul class="list">${draft.res.map((f, i) => `
    <li class="tap" data-act="foodPick" data-i="${i}"><div class="grow"><div class="title">${h(f.name)}</div>
      <div class="muted">${FOOD_KIND[f.kind]} ・ ${h(f.amount)}あたり ${r0(f.kcal)}kcal ・ P ${r1(f.protein)} / F ${r1(f.fat)} / C ${r1(f.carbs)}</div></div><span class="add">＋</span></li>`).join('')}</ul>`
    : `<p class="muted">「${h(q)}」は辞書にありませんでした。ひらがなや短い言葉（例：からあげ）でも探せます。見つからなければ下の「AIに聞く」へ。</p>`;
}
function renderFoodSel() {
  const el = $('#fs-sel');
  if (!draft.sel.length) { el.innerHTML = ''; return; }
  const items = draft.sel.map(foodItem);
  const tot = k => r0(items.reduce((a, x) => a + x[k], 0));
  el.innerHTML = `<h4>選んだもの</h4>${draft.sel.map((x, i) => `<div class="fs-item">
      <div class="spread"><b class="small">${h(x.name)}</b><button class="icon-btn" data-act="foodDel" data-i="${i}" aria-label="削除">✕</button></div>
      <div class="row wrap fs-qty">
        ${(x.unit === 'g' ? [[50, '50g'], [100, '100g'], [150, '150g'], [200, '200g']] : [[0.5, '半分'], [1, '1人前'], [1.5, '大盛り']]).map(([v, l]) => `<button class="btn sm ${x.q === v ? 'on' : ''}" data-act="foodQty" data-i="${i}" data-v="${v}">${l}</button>`).join('')}
        <label class="qty-in"><input type="number" inputmode="decimal" step="${x.unit === 'g' ? 10 : 0.05}" min="0" data-in="foodQty" data-i="${i}" value="${x.q}">${x.unit === 'g' ? 'g' : '倍'}</label>
      </div>
      <div class="muted" id="fs-kcal-${i}">${h(items[i].amount)} ・ ${r0(items[i].kcal)}kcal（P ${r1(items[i].protein)} / F ${r1(items[i].fat)} / C ${r1(items[i].carbs)}）</div>
    </div>`).join('')}
    <div class="hint small" id="fs-total">合計 <b>${tot('kcal')}kcal</b> ・ たんぱく質 ${tot('protein')}g ・ 脂質 ${tot('fat')}g ・ 炭水化物 ${tot('carbs')}g</div>
    <button class="btn primary block" data-act="foodDone" style="margin-top:8px">この内容で記録へ進む</button>`;
}
function normalizeMeal(r) {
  const items = (r.items || []).map(i => ({
    name: String(i.name || '不明'),
    amount: String(i.amount || ''),
    kcal: num(i.kcal) || 0, protein: num(i.protein) || 0, fat: num(i.fat) || 0, carbs: num(i.carbs) || 0,
  }));
  return { name: r.name || items.map(i => i.name).join('・'), items, note: r.note || '' };
}

// ===================== トレーニング =====================
const ex = (name, sets, reps, rest, note = '') => ({ name, sets, reps, rest, weight: '', note });
// 時間の見積もり（分）
const WARMUP_MIN = 10, EX_MIN = 12, ABS_MIN = 5;

// 種目の一覧。group: push=押す / pull=引く / abs=腹 / legs=脚。goal: 目標との関係
const PARTS = [['chest', '胸'], ['back', '背中'], ['shoulder', '肩'], ['arm', '腕'], ['abs', '腹'], ['legs', '脚・お尻']];
const GOAL_TAGS = { chest: '胸の丸み', abs: '腹筋', look: '見た目の変化大' };
const beginnerTag = c => (c.beginner ? ' <span class="tag beginner">初心者におすすめ</span>' : '');
const CATALOG = [
  // 胸
  { id: 'c9', part: 'chest', group: 'push', eq: 'smith', name: 'ベンチプレス（スミスマシン）', sets: 3, reps: '8-10', rest: '2分', beginner: true,
    where: '大胸筋全体・肩の前・腕の裏', effect: 'バーの動く道すじが決まっていて、つぶれそうになってもフックに掛ければ止められるので、初心者でも安全に重さを扱える。胸板を厚くする基本の種目', note: 'バーを胸の真ん中（乳首の少し上）に下ろす' },
  { id: 'c3', part: 'chest', group: 'push', eq: 'free', name: 'ベンチプレス', sets: 3, reps: '6-10', rest: '2分',
    where: '大胸筋全体・肩の前・腕の裏', effect: '胸全体のボリュームが増えて、胸板が厚くなる。上半身の筋力の土台', note: '肩甲骨を寄せて胸を張ったまま' },
  { id: 'c1', part: 'chest', group: 'push', eq: 'smith', name: 'インクラインベンチプレス（スミスマシン）', sets: 3, reps: '8-10', rest: '2分', goal: 'chest',
    where: '大胸筋の上部・肩の前・腕の裏', effect: '胸の上の方に厚みが出て、胸が上向きに丸く盛り上がって見える。「丸みのある胸板」の土台になる種目', note: 'ベンチは30度くらい。鎖骨の下あたりに下ろす' },
  { id: 'c2', part: 'chest', group: 'push', eq: 'free', name: 'インクラインダンベルプレス', sets: 3, reps: '8-12', rest: '90秒', goal: 'chest',
    where: '大胸筋の上部', effect: '左右別々に動かすので深く下ろせて、胸の上部をしっかり伸ばして丸みを作れる。左右差の改善にも', note: '下ろしたとき胸がしっかり伸びるところまで' },
  { id: 'c4', part: 'chest', group: 'push', eq: 'machine', name: 'チェストプレス（マシン）', sets: 3, reps: '10-12', rest: '90秒',
    where: '大胸筋全体', effect: '動く道すじが決まっているので、胸に効かせやすい。最後の追い込みにも向く', note: '胸を張ったまま押す' },
  { id: 'c5', part: 'chest', group: 'push', eq: 'machine', name: 'ペックフライ（マシン）', sets: 3, reps: '12-15', rest: '60秒',
    where: '大胸筋の内側・全体', effect: '胸の真ん中の谷間のラインがはっきりして、胸の形が立体的になる', note: '腕で抱きしめるように寄せる' },
  { id: 'c6', part: 'chest', group: 'push', eq: 'cable', name: 'ケーブルクロスオーバー（下から上へ）', sets: 3, reps: '12-15', rest: '60秒', goal: 'chest',
    where: '大胸筋の上部・内側', effect: '鎖骨の下の内側が盛り上がり、胸の上部に丸みが出る', note: '胸の上の方で手を寄せる' },
  { id: 'c7', part: 'chest', group: 'push', eq: 'cable', name: 'ケーブルクロスオーバー（上から下へ）', sets: 3, reps: '12-15', rest: '60秒',
    where: '大胸筋の下部', effect: '胸の下のラインがくっきりして、胸とお腹の境目がはっきりする', note: 'おへその前で手を寄せる' },
  { id: 'c8', part: 'chest', group: 'push', eq: 'body', name: 'ディップス（アシストマシン可）', sets: 3, reps: '8-12', rest: '90秒',
    where: '大胸筋の下部・腕の裏', effect: '胸の下部と腕の裏が鍛えられ、上半身が逆三角形に近づく', note: '少し前かがみになると胸に効く' },
  // 背中
  { id: 'b1', part: 'back', group: 'pull', eq: 'machine', name: 'ラットプルダウン', sets: 3, reps: '10-12', rest: '90秒', goal: 'look',
    where: '背中の広がり（広背筋）', effect: '背中に横幅が出て逆三角形に。ウエストが細く見える', note: '胸に向かって引く' },
  { id: 'b2', part: 'back', group: 'pull', eq: 'machine', name: 'シーテッドロー（マシン or ケーブル）', sets: 3, reps: '10-12', rest: '90秒',
    where: '背中の厚み（広背筋・僧帽筋の中部）', effect: '背中が厚くなり、姿勢がよくなって胸が張って見える', note: '肩甲骨を寄せるように引く' },
  { id: 'b3', part: 'back', group: 'pull', eq: 'free', name: 'ワンハンドダンベルロー', sets: 3, reps: '10-12', rest: '60秒',
    where: '広背筋・背中の下側', effect: '背中の左右差を整え、引き締まった背中に', note: 'ひじを腰の方へ引く' },
  { id: 'b4', part: 'back', group: 'pull', eq: 'body', name: '懸垂（アシストマシン可）', sets: 3, reps: '6-10', rest: '90秒', goal: 'look',
    where: '広背筋・腕', effect: '背中の広がりが一番大きく出る代表的な種目', note: '胸をバーに近づける' },
  // 肩
  { id: 's1', part: 'shoulder', group: 'push', eq: 'machine', name: 'ショルダープレス（マシン or ダンベル）', sets: 3, reps: '8-12', rest: '90秒',
    where: '肩の前・横（三角筋）', effect: '肩が丸く大きくなり、上半身ががっしり見える', note: '腰を反らせすぎない' },
  { id: 's2', part: 'shoulder', group: 'push', eq: 'free', name: 'サイドレイズ（ダンベル）', sets: 3, reps: '12-15', rest: '60秒', goal: 'look',
    where: '肩の横（三角筋の中部）', effect: '肩幅が広がり、ウエストが細く・胸板が厚く見える。見た目が一番変わりやすい種目のひとつ', note: '小指側を少し上に、肩の高さまで' },
  { id: 's3', part: 'shoulder', group: 'push', eq: 'cable', name: 'ケーブルサイドレイズ', sets: 3, reps: '12-15', rest: '60秒',
    where: '肩の横', effect: '下ろしたときも負荷が抜けず、肩の丸みを作りやすい', note: '片手ずつゆっくり' },
  { id: 's4', part: 'shoulder', group: 'pull', eq: 'machine', name: 'リアデルトフライ（マシン）', sets: 3, reps: '12-15', rest: '60秒',
    where: '肩の後ろ（三角筋の後部）', effect: '横から見た肩が丸くなり、猫背が直って胸が張って見える', note: '腕を大きく後ろへ開く' },
  { id: 's5', part: 'shoulder', group: 'pull', eq: 'cable', name: 'フェイスプル（ケーブル）', sets: 3, reps: '15', rest: '60秒',
    where: '肩の後ろ・背中の上部', effect: '巻き肩・猫背を防ぎ、胸を張った姿勢になって胸板が目立つ', note: 'ロープを顔の横まで引く' },
  // 腕
  { id: 'a1', part: 'arm', group: 'pull', eq: 'free', name: 'ダンベルカール', sets: 3, reps: '10-12', rest: '60秒',
    where: '力こぶ（上腕二頭筋）', effect: '力こぶが盛り上がり、Tシャツの袖まわりがたくましくなる', note: 'ひじを体の横に固定' },
  { id: 'a2', part: 'arm', group: 'pull', eq: 'free', name: 'ハンマーカール', sets: 3, reps: '10-12', rest: '60秒',
    where: '腕の外側・前腕', effect: '腕が正面から見て太くなり、握力も強くなる', note: '親指を上にしたまま上げる' },
  { id: 'a3', part: 'arm', group: 'push', eq: 'cable', name: 'トライセプスプッシュダウン（ケーブル）', sets: 3, reps: '10-15', rest: '60秒',
    where: '腕の裏（上腕三頭筋）', effect: '二の腕が引き締まって腕全体が太く見える（腕の太さの約3分の2は裏側）。胸のプレス種目の重さも伸びる', note: 'ひじを動かさずに下へ押す' },
  // 腹
  { id: 'ab1', part: 'abs', group: 'abs', eq: 'cable', name: 'ケーブルクランチ', sets: 3, reps: '12-15', rest: '60秒', goal: 'abs',
    where: '腹筋の上部〜中部（腹直筋）', effect: '重りで負荷をかけられるので、腹筋の凹凸（ブロック）が深く大きくなる', note: 'おへそをのぞき込むように丸める' },
  { id: 'ab2', part: 'abs', group: 'abs', eq: 'body', name: 'ハンギングレッグレイズ', sets: 3, reps: '8-12', rest: '60秒', goal: 'abs',
    where: '腹筋の下部', effect: '下腹が鍛えられ、6パックの下の段が見えやすくなる', note: 'ぶら下がって、反動を使わずに脚を上げる' },
  { id: 'ab3', part: 'abs', group: 'abs', eq: 'body', name: 'レッグレイズ（ベンチ・床）', sets: 3, reps: '10-15', rest: '60秒', goal: 'abs',
    where: '腹筋の下部', effect: '初心者でもできる下腹の種目。ぽっこりお腹の引き締めに', note: '腰が反らないように' },
  { id: 'ab4', part: 'abs', group: 'abs', eq: 'body', name: 'アブローラー（膝つき）', sets: 3, reps: '8-12', rest: '60秒', goal: 'abs',
    where: '腹筋全体・体幹', effect: 'お腹全体を強く引き締め、腹筋の縦のラインもはっきりする', note: '腰を反らせない範囲で転がす' },
  { id: 'ab5', part: 'abs', group: 'abs', eq: 'body', name: 'リバースクランチ', sets: 3, reps: '12-15', rest: '60秒', goal: 'abs',
    where: '腹筋の下部', effect: '下腹のぽっこりを引き締める', note: 'お尻を床から少し浮かせる' },
  { id: 'ab6', part: 'abs', group: 'abs', eq: 'cable', name: 'ケーブルウッドチョップ', sets: 3, reps: '12', rest: '60秒',
    where: '脇腹（腹斜筋）', effect: 'ウエストのくびれと脇腹のラインが出る', note: '腕ではなく体をひねって引く' },
  { id: 'ab8', part: 'abs', group: 'abs', eq: 'machine', name: 'アブドミナルクランチ（マシン）', sets: 3, reps: '12-15', rest: '60秒', goal: 'abs',
    where: '腹筋の上部〜中部（腹直筋）', effect: '座ったまま重りで負荷をかけられ、フォームが安定するので初心者でも腹筋のブロックを大きくしやすい', note: '腕ではなくお腹を丸めて下ろす', beginner: true },
  { id: 'ab7', part: 'abs', group: 'abs', eq: 'body', name: 'プランク', sets: 3, reps: '45秒', rest: '45秒',
    where: '体幹', effect: '体幹が安定して、お腹が内側から締まる', note: '頭からかかとまで一直線' },
  // 脚・お尻
  { id: 'l1', part: 'legs', group: 'legs', eq: 'smith', name: 'スクワット（スミスマシン or パワーラック）', sets: 3, reps: '8-10', rest: '2分',
    where: '太もも・お尻', effect: '体で一番大きい筋肉を使うので代謝が上がり、脂肪が落ちやすくなる', note: '膝とつま先の向きをそろえる' },
  { id: 'l2', part: 'legs', group: 'legs', eq: 'machine', name: 'レッグプレス', sets: 3, reps: '10-12', rest: '90秒',
    where: '太ももの前・お尻', effect: '腰への負担が少なく、脚全体を鍛えられる', note: '膝を伸ばしきらない' },
  { id: 'l3', part: 'legs', group: 'legs', eq: 'free', name: 'ルーマニアンデッドリフト（ダンベル）', sets: 3, reps: '10-12', rest: '90秒',
    where: '太ももの裏・お尻・背中の下', effect: 'お尻が上がり、後ろ姿が引き締まる', note: '背中を丸めず、お尻を後ろへ引く' },
  { id: 'l4', part: 'legs', group: 'legs', eq: 'machine', name: 'レッグカール（マシン）', sets: 3, reps: '12-15', rest: '60秒',
    where: '太ももの裏', effect: '太ももの裏が引き締まり、脚のラインが整う', note: 'ゆっくり戻す' },
  { id: 'l5', part: 'legs', group: 'legs', eq: 'machine', name: 'レッグエクステンション（マシン）', sets: 3, reps: '12-15', rest: '60秒',
    where: '太ももの前', effect: '膝の上の筋肉が発達し、脚にメリハリが出る', note: '上で1秒止める' },
];
// 宅トレ（自重トレーニング）の種目
const HOME_CATALOG = [
  { id: 'h3', part: 'chest', group: 'push', name: 'デクラインプッシュアップ（足を椅子に乗せる）', sets: 3, reps: '8-15', rest: '60秒', goal: 'chest', alt: '膝つき腕立て伏せ',
    where: '大胸筋の上部・肩の前・腕の裏', effect: '足を高くすると胸の上部に効き、ジムのインクライン種目の代わりになる。胸の丸みづくりに', note: '体を一直線にして、胸を床に近づける' },
  { id: 'h1', part: 'chest', group: 'push', name: '腕立て伏せ', sets: 3, reps: '10-15', rest: '60秒', alt: '膝つき腕立て伏せ',
    where: '大胸筋全体・肩の前・腕の裏', effect: '胸全体を鍛える基本の種目。ベンチプレスの代わりになる', note: '手は肩幅より少し広く。3秒かけて下ろす' },
  { id: 'h4', part: 'chest', group: 'push', name: 'ワイドプッシュアップ', sets: 3, reps: '10-15', rest: '60秒', alt: '膝つき腕立て伏せ',
    where: '大胸筋の外側・全体', effect: '手幅を広くして胸を大きく伸ばし、胸の横幅を広げる', note: '手は肩幅の1.5倍くらい' },
  { id: 'h2', part: 'chest', group: 'push', name: '膝つき腕立て伏せ', sets: 3, reps: '10-15', rest: '60秒',
    where: '大胸筋全体', effect: '普通の腕立てがきついときの軽いやり方。フォームを覚えるのにも向く', note: '膝から頭まで一直線に' },
  { id: 'h7', part: 'shoulder', group: 'push', name: 'パイクプッシュアップ', sets: 3, reps: '8-12', rest: '60秒',
    where: '肩（三角筋）・腕の裏', effect: 'お尻を高く上げた腕立てで、肩を丸く大きくする。ショルダープレスの代わり', note: '頭を両手の間に下ろす' },
  { id: 'h5', part: 'arm', group: 'push', name: 'ダイヤモンドプッシュアップ', sets: 3, reps: '8-12', rest: '60秒', alt: '椅子ディップス',
    where: '腕の裏（上腕三頭筋）・胸の内側', effect: '手を近づけた腕立てで、二の腕を引き締めて太くする', note: '両手でひし形を作る。ひじは体の横に' },
  { id: 'h6', part: 'arm', group: 'push', name: '椅子ディップス', sets: 3, reps: '10-15', rest: '60秒',
    where: '腕の裏（上腕三頭筋）', effect: '椅子を使って二の腕を鍛える。腕全体が太く見える', note: '動かない椅子で。お尻を椅子のすぐ前に' },
  { id: 'h8', part: 'back', group: 'pull', name: 'スーパーマン', sets: 3, reps: '12-15', rest: '45秒',
    where: '背中・腰（脊柱起立筋）・お尻', effect: '背中を鍛えて姿勢がよくなり、胸が張って見える', note: 'うつ伏せで手足を同時に上げ、2秒止める' },
  { id: 'h9', part: 'back', group: 'pull', name: 'リバーススノーエンジェル', sets: 3, reps: '12-15', rest: '45秒',
    where: '背中の上部・肩の後ろ', effect: '肩甲骨まわりを鍛え、猫背・巻き肩を防ぐ。ジムのフェイスプルの代わり', note: 'うつ伏せで腕を浮かせたまま、頭の上から腰まで大きく動かす' },
  { id: 'h16', part: 'legs', group: 'legs', name: 'スクワット（自重）', sets: 3, reps: '15-20', rest: '60秒',
    where: '太もも・お尻', effect: '大きい筋肉を使うので代謝が上がる', note: 'お尻を後ろに引いて、膝とつま先の向きをそろえる' },
  { id: 'h17', part: 'legs', group: 'legs', name: 'ブルガリアンスクワット', sets: 3, reps: '10-12', rest: '60秒',
    where: '太もも・お尻', effect: '片脚ずつで自重でも強い負荷がかかる', note: '後ろ足を椅子に乗せる。左右それぞれ' },
  { id: 'h18', part: 'legs', group: 'legs', name: 'ヒップリフト', sets: 3, reps: '15', rest: '45秒',
    where: 'お尻・太ももの裏', effect: 'お尻を引き締め、後ろ姿が整う', note: 'あお向けで膝を立て、お尻を上げて2秒止める' },
  { id: 'h11', part: 'abs', group: 'abs', name: 'クランチ', sets: 3, reps: '15-20', rest: '45秒', goal: 'abs',
    where: '腹筋の上部', effect: '腹筋の上の段をはっきりさせる', note: 'おへそをのぞき込むように。反動を使わない' },
  { id: 'h12', part: 'abs', group: 'abs', name: 'レッグレイズ（床）', sets: 3, reps: '10-15', rest: '45秒', goal: 'abs',
    where: '腹筋の下部', effect: '下腹を引き締め、6パックの下の段を出す', note: '腰が浮かないように、ゆっくり下ろす' },
  { id: 'h13', part: 'abs', group: 'abs', name: 'プランク', sets: 3, reps: '45秒', rest: '30秒',
    where: '体幹', effect: 'お腹を内側から締め、姿勢を安定させる', note: '頭からかかとまで一直線' },
  { id: 'h14', part: 'abs', group: 'abs', name: 'バイシクルクランチ', sets: 3, reps: '左右15回', rest: '45秒', goal: 'abs',
    where: '腹筋全体・脇腹', effect: '腹筋と脇腹を同時に鍛え、くびれのラインも出る', note: 'ひじと反対の膝を近づける' },
  { id: 'h15', part: 'abs', group: 'abs', name: 'マウンテンクライマー', sets: 3, reps: '30秒', rest: '30秒',
    where: '腹筋・全身', effect: '息が上がるので脂肪燃焼にもなる', note: '腕立ての姿勢で膝を胸に引きつける' },
];
const HOME_PICKS = { chest: ['h3', 'h1', 'h4'], back: ['h8', 'h9'], legs: ['h16', 'h17', 'h18'], shoulder: ['h7'], arm: ['h5', 'h6'] };
const HOME_ABS = ['h11', 'h12', 'h14', 'h13', 'h15'];
const homeEx = id => HOME_CATALOG.find(c => c.id === id);
// ジムのメニューと同じ部位を、自重で鍛えるメニューにする（家では待ち時間がないので1種目約7分）
function homeDay(day, t) {
  const parts = dayParts(day);
  if (!parts.length) return day;
  const absN = t.minutes >= 60 ? 2 : 1;
  const mainN = Math.max(2, Math.floor((t.minutes - 5 - 4 * absN) / 7));
  const order = Object.keys(PART_ORDER).filter(p => parts.includes(p) && HOME_PICKS[p]);
  const main = [];
  for (let k = 0; main.length < mainN && k < 3; k++) for (const p of order) { const id = HOME_PICKS[p][k]; if (id && main.length < mainN) main.push(homeEx(id)); }
  // 時間に余裕があれば、ほかの上半身の自重種目で埋める（脚は選んでいるときだけ）
  const legsOk = chosenList().some(c => c.part === 'legs');
  for (const id of ['h7', 'h5', 'h9', 'h8', 'h6', ...(legsOk ? ['h16', 'h18'] : [])]) { if (main.length >= mainN) break; if (!main.some(c => c.id === id)) main.push(homeEx(id)); }
  const start = (currentPlan().days.findIndex(d => d.name === day.name) * 2) % HOME_ABS.length;
  const pins = pinnedList().filter(c => c.eq === 'body' && c.group === 'abs');
  const abs = [...pins, ...Array.from({ length: Math.max(0, absN - pins.length) }, (_, i) => homeEx(HOME_ABS[(start + i) % HOME_ABS.length]))];
  const condNote = { tired: '疲れている日は2セットでOK', form: '回数より「ゆっくり・正しいフォーム」を優先', push: '最後のセットは限界まで' }[t.cond] || '';
  const names = [...main, ...abs].map(c => c.name);
  const exercises = [...main, ...abs].map((c, i) => ({ name: c.name, sets: t.cond === 'tired' ? 2 : t.cond === 'push' && i < 2 ? 4 : c.sets, reps: c.reps, rest: c.rest, weight: '自重', alt: c.alt && !names.includes(c.alt) ? c.alt : '', note: c.note, adj: true, todayNote: c.group !== 'abs' && condNote ? condNote : '' }));
  return { ...day, home: true, focus: `🏠 自宅でできる自重トレーニング（${partsLabel(main)}）。ジムの${menuLabel(day)}の代わり`, cardio: null, exercises,
    estMin: 5 + main.length * 7 + abs.length * 4, todayLabel: '宅トレ' };
}
const DEFAULT_CHOSEN = ['c9', 'c1', 'c2', 'c4', 'c6', 'b1', 'b2', 's2', 's5', 'a1', 'a3', 'ab1', 'ab2', 'ab4'];
// 並び順: 1=重さを扱う多関節種目（フリーウェイト・スミス・自重）→ 2=マシンの多関節種目 → 3=仕上げの単関節種目 → 4=腹
const TIER = { c9: 1, c3: 1, c1: 1, c2: 1, c8: 1, b4: 1, b3: 1, l1: 1, l3: 1, c4: 2, b1: 2, b2: 2, s1: 2, l2: 2 };
const tierOf = c => (c.group === 'abs' ? 4 : TIER[c.id] || 3);
const PART_ORDER = { chest: 0, back: 1, legs: 2, shoulder: 3, arm: 4, abs: 5 };
const byTier = list => [...list].sort((a, b) => tierOf(a) - tierOf(b) || PART_ORDER[a.part] - PART_ORDER[b.part] || CATALOG.indexOf(a) - CATALOG.indexOf(b));
const normName = n => String(n || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s/g, '');
const catalogFor = name => CATALOG.find(c => c.name === name) || HOME_CATALOG.find(c => c.name === name) || CATALOG.find(c => normName(c.name) === normName(name)) || HOME_CATALOG.find(c => normName(c.name) === normName(name));
const eqOk = c => c.eq === 'body' || S.settings.equipment.includes(c.eq) || (c.id === 'b2' && S.settings.equipment.includes('cable')) || (c.id === 's1' && S.settings.equipment.includes('free'));
const chosenList = () => CATALOG.filter(c => (S.settings.chosen || DEFAULT_CHOSEN).includes(c.id) && eqOk(c));

function partsLabel(items) {
  return PARTS.filter(([k]) => items.some(c => c.part === k)).map(([, l]) => l).join('・');
}
function defaultPlan(n) {
  const chosen = chosenList();
  const by = g => chosen.filter(c => c.group === g);
  const push = byTier(by('push')), pull = byTier(by('pull')), legs = byTier(by('legs')), abs = by('abs');
  const chest = push.filter(c => c.part === 'chest');
  const L = abs.length;
  const st = S.settings;
  const wMin = num(st.weightMin) || 60, cMin = num(st.cardioMin) || 20;
  // ウォームアップ10分＋1種目約12分（空き待ち・準備込み）＋腹筋1種目約5分で、余裕を残して組む
  const absN = wMin >= 75 ? 2 : 1;
  const mainN = Math.max(2, Math.floor((wMin - WARMUP_MIN - ABS_MIN * absN) / EX_MIN));
  const maxEx = mainN + absN;
  const cardioPlan = st.sessionMode === 'weights' ? null
    : { type: 'エアロバイク', min: cMin, note: '会話ができるくらいの強さで。筋トレの後にやると脂肪が燃えやすい' };
  // 腹の種目は日ごとに入れ替える
  const day = (items, focus, i) => {
    // 📌の腹筋種目は毎回入れ、残りの枠を日ごとに入れ替える
    const pinAbs = abs.filter(c => pinnedIds().has(c.id)), others = abs.filter(c => !pinnedIds().has(c.id));
    const need = Math.max(0, absN - pinAbs.length), O = others.length;
    const absPart = [...pinAbs, ...(O ? [...new Set(Array.from({ length: need }, (_, k) => others[(i * need + k) % O]))] : [])];
    const list = byTier([...new Set(items)].slice(0, maxEx - absPart.length)).concat(absPart);
    const est = WARMUP_MIN + list.reduce((a, c) => a + (c.group === 'abs' ? ABS_MIN : EX_MIN), 0);
    return items.length ? { name: partsLabel(list), focus, estMin: est + (cardioPlan ? cMin : 0), cardio: cardioPlan, exercises: list.map(c => ex(c.name, c.sets, c.reps, c.rest, c.note)) } : null;
  };
  // 胸の目標があるので胸は週2回以上。2回目以降は胸の上部（丸み）の種目を優先
  const upper = [...chest.filter(c => c.goal === 'chest'), ...chest.filter(c => c.goal !== 'chest')];
  const shoulderSide = push.filter(c => c.part === 'shoulder');
  const rest = push.slice(maxEx - absN); // 1日目に入りきらなかった「押す」種目は別の日へ
  let days;
  if (n <= 2) {
    days = [day(push, '「押す」動きで、胸を中心に鍛える日', 0), day([...pull.slice(0, 3), ...upper.slice(0, 1), ...rest, ...pull.slice(3), ...legs, ...upper.slice(1, 2)], '「引く」動きで背中を中心に。胸ももう一度', 1)];
  } else if (legs.length) {
    days = [day(push, '「押す」動きで、胸を中心に鍛える日', 0), day(legs, '脚の日', 1), day([...pull, ...rest, ...upper.slice(0, 2)], '「引く」動きで背中を中心に。胸ももう一度', 2)];
  } else {
    days = [day(push, '「押す」動きで、胸を中心に鍛える日', 0), day(pull, '「引く」動きで、背中を中心に鍛える日', 1), day([...upper.slice(0, 3), ...rest, ...shoulderSide], '胸の丸みを重点的に。胸と肩をもう一度', 2)];
  }
  days = days.filter(Boolean);
  if (st.sessionMode === 'cardio') {
    const types = ['エアロバイク', 'トレッドミル（ウォーキング・ランニング）', 'クロストレーナー'];
    days = Array.from({ length: Math.min(n, 3) }, (_, i) => ({ name: '有酸素運動', focus: '会話ができるくらいの強さで続ける', estMin: cMin, cardio: { type: types[i % 3], min: cMin, note: '最後の5分だけ少しペースを上げる' }, exercises: [] }));
  }
  if (!days.length) days = [{ name: '種目が選ばれていません', focus: '「やりたい種目を選ぶ」から種目を選んでください', exercises: [] }];
  days.forEach((d, i) => { d.name = `${'ABCD'[i]} ${d.name}`; });
  return {
    source: 'default',
    createdAt: ymd(),
    days,
    tips: [
      /腹/.test(st.goals.join()) && '腹筋を割るには「腹筋運動」より「体脂肪を減らす」ことが大事。食事の目標カロリーを守りましょう。',
      /胸/.test(st.goals.join()) && '胸の丸みは大胸筋の上部が決め手。インクライン（斜め）の種目を毎週欠かさずに。',
      '決めた回数が全セットできたら、次回は重さを少し（2.5kgほど）上げましょう。',
      '週に何回か続けることが一番大事。疲れている日は重さを軽くしてでも、ジムに行く習慣を守りましょう。',
    ].filter(Boolean),
  };
}
// 毎回必ず入れる種目（📌）
const pinnedIds = () => new Set(S.settings.pinned || []);
const pinnedList = () => CATALOG.filter(c => pinnedIds().has(c.id));
const isPinned = name => pinnedList().some(c => normName(c.name) === normName(name));
// メニューの各日に、📌の種目が入っていなければ最後に足す（有酸素だけの日は除く）
function withPinned(plan, home) {
  const pins = pinnedList().filter(c => !home || c.eq === 'body');
  if (!pins.length) return plan;
  return { ...plan, days: plan.days.map(d => (!d.exercises.length ? d : { ...d, exercises: [...d.exercises, ...pins.filter(c => !d.exercises.some(e => normName(e.name) === normName(c.name))).map(c => ex(c.name, c.sets, c.reps, c.rest, c.note))] })) };
}
const currentPlan = () => withPinned(S.plan || defaultPlan(S.settings.daysPerWeek));
// 途中保存のまま今日が終わっていない記録（翌日になれば、ふつうの記録として数える）
const inProgress = w => !!w.full && w.date === ymd();
const todayDraft = () => S.workouts.find(inProgress);
const sortedWorkouts = () => S.workouts.filter(w => !inProgress(w)).sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));

function nextPlanDay() {
  const days = currentPlan().days;
  const last = strengthWorkouts().at(-1);
  if (!last) return days[0];
  const i = days.findIndex(d => d.name === last.dayName);
  if (i >= 0) return days[(i + 1) % days.length];
  // メニューを作り直した直後など：前回鍛えた部位が回復するのを待たずにすむメニューを選ぶ
  const lastParts = new Set(last.exercises.map(e => catalogFor(e.name)?.part).filter(p => p && p !== 'abs'));
  const overlap = d => dayParts(d).filter(p => lastParts.has(p)).length;
  return [...days].sort((a, b) => suggestDate(a).date.localeCompare(suggestDate(b).date) || overlap(a) - overlap(b) || days.indexOf(a) - days.indexOf(b))[0];
}
// 回復の目安: 大きい筋肉は約72時間、小さい筋肉は約48時間
const BIG_PARTS = ['chest', 'back', 'legs'];
const recoverDays = part => (BIG_PARTS.includes(part) ? 3 : 2);
const dayParts = day => [...new Set((day?.exercises || []).map(e => catalogFor(e.name)?.part).filter(p => p && p !== 'abs'))];
const strengthWorkouts = () => sortedWorkouts().filter(w => w.exercises?.length);
function lastTrainedMap(extra) {
  const map = {};
  for (const w of strengthWorkouts()) for (const e of w.exercises) { const p = catalogFor(e.name)?.part; if (p) map[p] = w.date; }
  if (extra) for (const p of extra.parts) map[p] = extra.date;
  return map;
}
const sessionGap = () => Math.ceil(7 / (num(S.settings.daysPerWeek) || 3));
// day をやるのにおすすめの日。extra = まだ記録していない「今日やる分」
function suggestDate(day, extra) {
  const lastDate = extra?.date || strengthWorkouts().at(-1)?.date;
  if (!lastDate) return { date: ymd(), why: '' };
  let date = addDays(lastDate, sessionGap());
  let why = `週${S.settings.daysPerWeek}回のペース`;
  const map = lastTrainedMap(extra);
  for (const p of dayParts(day)) {
    if (!map[p]) continue;
    const ok = addDays(map[p], recoverDays(p));
    if (ok > date) { date = ok; why = `${PARTS.find(x => x[0] === p)[1]}の回復（約${recoverDays(p) * 24}時間）`; }
  }
  return { date: date < ymd() ? ymd() : date, why };
}
const dayAfter = day => { const ds = currentPlan().days; return ds[(ds.findIndex(d => d.name === day.name) + 1) % ds.length]; };
// 今日はやる日か休む日か
function trainStatus() {
  const todayW = strengthWorkouts().find(w => w.date === ymd());
  const next = nextPlanDay();
  if (todayW) return { state: 'done', todayW, next, nextAt: suggestDate(next) };
  const at = suggestDate(next);
  if (at.date <= ymd()) {
    const after = dayAfter(next);
    return { state: 'go', today: next, next: after, nextAt: suggestDate(after, { date: ymd(), parts: dayParts(next) }) };
  }
  return { state: 'rest', last: strengthWorkouts().at(-1), next, nextAt: at };
}
const menuLabel = d => { const i = currentPlan().days.findIndex(x => x.name === d.name); return `メニュー${'ABCDEFG'[i] || ''}`; };
const dayTitle = d => d.name.replace(/^[A-G]\s+/, '');
const SUPER = '<span class="muted">（超回復：筋トレで疲れた筋肉が、休むことで前より強くなること）</span>';
// ===================== 今日の時間・調子でメニューを調整 =====================
const CONDITIONS = [
  ['push', '追い込みたい', 1, '最初の2種目は1セット増やし、最後のセットは限界まで'],
  ['normal', 'ふつう', 1, ''],
  ['tired', '疲れ気味', 0.9, 'いつもの9割の重さで。回数は守る'],
  ['form', 'フォーム重視', 0.75, '軽めの重さで12〜15回。3秒かけて下ろし、反動を使わない'],
];
const TODAY_MINUTES = [30, 45, 60, 75, 90];
// 今日の入力（日付が変わったら元に戻る）
function todayInput() {
  const t = S.today && S.today.date === ymd() ? S.today : null;
  return { minutes: t?.minutes ?? (num(S.settings.weightMin) || 60), cond: t?.cond || 'normal', memo: t?.memo || '', aiDay: t?.aiDay || null, place: t?.place || 'gym' };
}
const isDefaultToday = t => t.minutes === (num(S.settings.weightMin) || 60) && t.cond === 'normal' && !t.aiDay && t.place !== 'home';
const round25 = v => Math.max(0, Math.round(v / 2.5) * 2.5);
const isAbsEx = e => catalogFor(e.name)?.group === 'abs';
// 基本の重さ: メニューの目安 → 無ければ前回の一番重いセット
function baseWeight(e) {
  const w = firstNum(e.weight);
  if (w) return w;
  const last = lastPerf(e.name);
  return last ? Math.max(...last.sets.map(s => num(s.w) || 0)) || null : null;
}
function adjustDay(day) {
  const t = todayInput();
  if (t.place === 'home') return homeDay(day, t);
  if (t.aiDay && t.aiDay.name === day.name) return t.aiDay;
  if (isDefaultToday(t) || !day.exercises.length) return day;
  const absN = t.minutes >= 75 ? 2 : 1;
  const mainN = Math.max(1, Math.floor((t.minutes - WARMUP_MIN - ABS_MIN * absN) / EX_MIN));
  let main = day.exercises.filter(e => !isAbsEx(e)), abs = day.exercises.filter(isAbsEx);
  const have = new Set(day.exercises.map(e => e.name));
  const extra = group => byTier(chosenList().filter(c => !have.has(c.name) && (group === 'abs' ? c.group === 'abs' : c.group !== 'abs')))
    .sort((a, b) => dayParts(day).includes(b.part) - dayParts(day).includes(a.part));
  // 時間が短ければ重い種目から残し、長ければ同じ部位の種目を足す
  if (main.length > mainN) main = main.slice(0, mainN);
  else for (const c of extra('main')) { if (main.length >= mainN) break; main.push(ex(c.name, c.sets, c.reps, c.rest, c.note)); }
  if (abs.length > absN) abs = [...abs.filter(e => isPinned(e.name)), ...abs.filter(e => !isPinned(e.name))].slice(0, Math.max(absN, abs.filter(e => isPinned(e.name)).length));
  else for (const c of extra('abs')) { if (abs.length >= absN) break; abs.push(ex(c.name, c.sets, c.reps, c.rest, c.note)); }
  const [, condLabel, factor, condNote] = CONDITIONS.find(c => c[0] === t.cond);
  const exercises = [...main, ...abs].map((e, i) => {
    const x = { ...e, adj: true };
    if (!isAbsEx(e)) {
      const bw = baseWeight(e);
      // ダンベルは1kg刻み、それ以外は2.5kg刻みで丸める
      const rounded = /ダンベル/.test(e.name) ? Math.round(bw * factor) : round25(bw * factor);
      if (bw && factor !== 1) { x.weight = `${rounded}kg`; x.usual = `${bw}kg`; }
      else if (bw && !x.weight) x.weight = `${bw}kg`;
      if (t.cond === 'form') x.reps = '12-15';
      if (t.cond === 'push' && i < 2) x.sets = (num(e.sets) || 3) + 1;
    }
    if (condNote && !isAbsEx(e)) x.todayNote = condNote;
    return x;
  });
  const est = WARMUP_MIN + exercises.reduce((a, e) => a + (isAbsEx(e) ? ABS_MIN : EX_MIN), 0);
  return { ...day, exercises, estMin: est + (day.cardio ? day.cardio.min : 0), todayLabel: `${t.minutes}分・${condLabel}` };
}
function placeSegHtml() {
  const t = todayInput();
  return `<div class="spread" style="margin-top:8px"><span class="small">📍 今日の場所</span>
      <div class="seg">${[['gym', '🏋️ ジム'], ['home', '🏠 宅トレ']].map(([v, l]) => `<button class="${t.place === v ? 'on' : ''}" data-act="todayPlace" data-v="${v}">${l}</button>`).join('')}</div></div>
    ${t.place === 'home' ? '<p class="muted" style="margin:4px 0 0">雨の日や忙しい日は、家で同じ部位を自重で鍛えましょう。</p>' : ''}`;
}
// いつでも一番上に出す記録ボタン（ジム／宅トレ／有酸素）
function recordBoxHtml() {
  const d = nextPlanDay(), dr = todayDraft();
  if (dr) return `<div class="card record-box"><h3>✍️ トレーニングを記録する</h3>
    <p class="small" style="margin-top:0">⏸ 「${h(dr.dayName)}」を記録中（${dr.exercises.length}種目を保存済み）</p>
    <button class="btn primary block" data-act="resumeDraft">▶ 続きを記録する</button>
    <button class="btn block" data-act="startCardio" style="margin-top:8px">🏃 有酸素運動を記録</button></div>`;
  return `<div class="card record-box"><h3>✍️ トレーニングを記録する</h3>
    <div class="grid2">
      <button class="btn primary" data-act="recordStart" data-v="gym">🏋️ ジムで記録</button>
      <button class="btn primary" data-act="recordStart" data-v="home">🏠 宅トレで記録</button>
    </div>
    <button class="btn block" data-act="startCardio" style="margin-top:8px">🏃 有酸素運動を記録</button>
    <p class="muted" style="margin:6px 0 0">${menuLabel(d)}「${h(dayTitle(d))}」の種目が入った状態で始まります。</p></div>`;
}
function todayAdjustHtml() {
  const t = todayInput();
  return `<div class="today-adj">
    ${placeSegHtml()}
    <div class="grid2">
      <label class="field">⏱ 今日の時間<select data-in="todayAdj" data-k="minutes">${TODAY_MINUTES.map(m => `<option value="${m}" ${m === t.minutes ? 'selected' : ''}>${m}分${m === (num(S.settings.weightMin) || 60) ? '（いつも）' : ''}</option>`).join('')}</select></label>
      <label class="field">😊 今日の調子<select data-in="todayAdj" data-k="cond">${CONDITIONS.map(([v, l]) => `<option value="${v}" ${v === t.cond ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <details ${t.memo || t.aiDay ? 'open' : ''}><summary class="small">📝 体調メモを書いてAIに相談する</summary>
      <textarea id="today-memo" placeholder="例：肩が少し痛い／寝不足／脚が筋肉痛">${h(t.memo)}</textarea>
      <button class="btn sm" data-act="todayAI" style="margin-top:6px">🤖 AIに相談して今日のメニューを調整</button>
    </details>
    ${!isDefaultToday(t) ? `<p class="small hint">今日だけ「${t.place === 'home' ? `🏠 宅トレ・${t.minutes}分` : t.aiDay ? 'AIが調整' : `${t.minutes}分・${CONDITIONS.find(c => c[0] === t.cond)[1]}`}」のメニューにしています。${t.aiDay?.advice ? `<br>💬 ${h(t.aiDay.advice)}` : ''}
      <button class="btn sm" data-act="todayReset" style="margin-top:4px">いつものメニューに戻す</button></p>` : ''}
  </div>`;
}
function todayPrompt(day, t) {
  return `あなたは経験豊富なパーソナルトレーナーです。今日のジムのメニューを、利用者の今日の状態に合わせて調整してください。
【元のメニュー】${JSON.stringify({ name: day.name, exercises: day.exercises.map(e => ({ name: e.name, sets: e.sets, reps: e.reps, rest: e.rest, weight: e.weight })), cardio: day.cardio })}
【今日の時間】${t.minutes}分（ウォームアップ10分＋1種目3セット約12分＋腹筋1種目約5分で見積もり、5〜10分の余裕を残す）
【今日の調子】${CONDITIONS.find(c => c[0] === t.cond)[1]}
【体調メモ】${t.memo || 'なし'}
【やりたい種目（この中から選ぶ）】
${chosenList().map(c => `- ${c.name}`).join('\n')}
【種目ごとの実力（kg）】
${strengthText()}
- 痛みがある部位は無理に鍛えず、別の部位の種目や軽い重さに置き換えてください。痛みが強い場合は休むことをすすめてください。
- 重さの目安（weight）は必ず書き、順番は重い種目→マシン→仕上げの種目→腹筋にしてください。
次の形のJSONだけを返してください:
{"focus":"今日の狙い（1文）","estMin":45,"advice":"今日の注意点（1〜2文）","cardio":null,"exercises":[{"name":"種目名","sets":3,"reps":"8-12","rest":"90秒","weight":"40kg","alt":"混んでいたときの代わり","note":"コツを短く"}]}`;
}

// 重さの目安が無い種目は、前回の記録 → 無ければ実力から推定した重さを出す
function guessWeight(e, d) {
  if (e.weight || d.home) return e;
  const last = lastPerf(e.name);
  if (last) { const w = Math.max(...last.sets.map(s => num(s.w) || 0)); return w ? { ...e, weight: `${w}kg`, usual: '' } : e; }
  const g = estimateWeight(e.name, e.reps);
  return g ? { ...e, weight: `${g}kg（目安）` } : e;
}
function dayCardHtml(d, opts = {}) {
  const i = currentPlan().days.findIndex(x => x.name === d.name);
  const rec = opts.button !== false && !opts.compact;
  const startAttr = `data-act="startDay" data-i="${i}" ${opts.today ? 'data-today="1"' : ''}`;
  return `<div class="day-head"><span class="day-no">${menuLabel(d)}</span><div class="grow"><div class="day-name">${h(dayTitle(d))}</div><div class="muted">${h(d.focus || '')}${d.estMin ? ` ・ 約${r0(d.estMin)}分` : ''}</div></div>
      ${opts.button === false ? '' : `<button class="btn sm rec-btn" ${startAttr}>✍️ 記録</button>`}</div>
    ${d.exercises.map((e, j) => `<div class="ex"><div class="ex-name">${j + 1}. ${howtoLink(e.name)}${rec ? `<button class="rec-chip" ${startAttr} data-ex="${h(e.name)}">✍️ 記録</button>` : ''}</div>
      <div class="small"><span class="tag">${h(e.sets)}セット × ${h(e.reps)}</span>${(e = guessWeight(e, d)).weight ? `<b>${h(e.weight)}${weightLbNote(e.weight)}</b>${e.usual ? `<span class="muted">（いつもは${h(e.usual)}）</span>` : ''} ・ ` : ''}<span class="muted">休憩 ${h(e.rest || '-')}</span></div>
      ${e.todayNote ? `<div class="small today-note">🎯 今日は：${h(e.todayNote)}</div>` : ''}
      ${opts.compact ? '' : `${e.progression ? `<div class="small">📈 ${h(e.progression)}</div>` : ''}${effectHtml(e.name)}${e.note ? `<div class="muted">💡 ${h(e.note)}</div>` : ''}`}
      ${(alt => (alt ? `<div class="small alt">🔁 ${d.home ? 'きつければ' : '混んでいたら'}：${howtoLink(alt)}</div>` : ''))(altOf(e, d.exercises.map(x => x.name)))}</div>`).join('')}
    ${d.cardio ? `<div class="ex"><div class="ex-name">🏃 有酸素：${h(d.cardio.type)} ${r0(d.cardio.min)}分</div>${d.cardio.note && !opts.compact ? `<div class="muted">💡 ${h(d.cardio.note)}</div>` : ''}</div>` : ''}
    ${opts.button === false ? '' : `<button class="btn ${opts.primary ? 'primary' : 'sm'} block" ${startAttr} style="margin-top:8px">${opts.buttonText || `${menuLabel(d)}で記録する`}</button>`}`;
}
// 器具が使えないときの代わり（上から順に、使える器具で、その日のメニューに無いものを選ぶ）
const ALT = {
  c9: ['c3', 'c4'], c3: ['c9', 'c4'], c1: ['c2', 'c6', 'c4'], c2: ['c1', 'c6', 'c4'], c4: ['c9', 'c3', 'c2'], c5: ['c7', 'c6'], c6: ['c5', 'c2'], c7: ['c5', 'c8'], c8: ['c7', 'c4'],
  b1: ['b4', 'b3'], b2: ['b3', 'b1'], b3: ['b2', 'b1'], b4: ['b1', 'b3'],
  s1: ['s2'], s2: ['s3', 's1'], s3: ['s2', 's1'], s4: ['s5'], s5: ['s4'],
  a1: ['a2'], a2: ['a1'], a3: ['c8'],
  ab1: ['ab8', 'ab4', 'ab5'], ab8: ['ab1', 'ab4'], ab2: ['ab3', 'ab5'], ab3: ['ab5', 'ab2'], ab4: ['ab1', 'ab7'], ab5: ['ab3', 'ab2'], ab6: ['ab7'], ab7: ['ab4', 'ab6'],
  l1: ['l2'], l2: ['l1'], l3: ['l4'], l4: ['l3'], l5: ['l2'],
};
function altFor(name, exclude = []) {
  const c = catalogFor(name);
  if (!c) return null;
  const ex = new Set(exclude);
  return (ALT[c.id] || []).map(id => CATALOG.find(x => x.id === id)).find(x => x && eqOk(x) && !ex.has(x.name))?.name || null;
}
const altOf = (e, exclude) => e.alt || altFor(e.name, exclude);
function lastPerf(name, beforeId) {
  const ws = sortedWorkouts().reverse();
  for (const w of ws) {
    if (w.id === beforeId) continue;
    const e = w.exercises.find(x => x.name === name) || w.exercises.find(x => normName(x.name) === normName(name));
    if (e && e.sets.length) return { date: w.date, sets: e.sets };
  }
  return null;
}
const setsText = (sets, u = 'kg') => sets.map(s => `${toUnit(num(s.w), u) ?? '-'}${u}×${s.r ?? '-'}`).join(', ');
const cardioText = cs => (cs || []).map(c => `${c.type} ${c.min}分${num(c.km) ? ` ${c.km}km` : ''}${num(c.kcal) ? ` ${c.kcal}kcal` : ''}`).join('、');
function overloadHint(e, last, u = 'kg') {
  if (!last || /秒/.test(e.reps || '')) return '';
  const top = parseInt(String(e.reps || '').split(/[-〜~]/).pop(), 10);
  if (!top) return '';
  return last.sets.every(s => num(s.r) >= top) ? `前回は全セット${top}回できました → 今日は少し重くしてみましょう（${u === 'lb' ? '+5lbほど' : '+2.5kgほど'}）` : '';
}
// 推定の最大重量（1回だけ挙げられる重さ）: 重さ×(1+回数/30)
const e1rm = s => (num(s.w) > 0 && num(s.r) > 0 ? num(s.w) * (1 + num(s.r) / 30) : 0);
// 種目ごとの重さの比（ベンチプレスの最大重量を1としたときの目安。ダンベルは片手分）
const LIFT_RATIO = {
  c9: 0.95, c3: 1, c1: 0.8, c2: 0.32, c4: 0.8, c5: 0.6, c6: 0.18, c7: 0.2,
  b1: 0.85, b2: 0.85, b3: 0.35, s1: 0.6, s2: 0.1, s3: 0.07, s4: 0.45, s5: 0.35,
  a1: 0.15, a2: 0.17, a3: 0.4, ab1: 0.5, ab8: 0.5, ab6: 0.2,
  l1: 1.2, l2: 2, l3: 0.35, l4: 0.45, l5: 0.55,
};
// 今の実力を「ベンチプレスの最大重量」に直したもの。記録が無ければ体重から（初心者の目安）
function benchLevel() {
  const since = addDays(ymd(), -90), vals = [];
  const seen = new Set();
  for (const w of sortedWorkouts().reverse()) {
    if (w.date < since) break;
    for (const e of w.exercises) {
      const c = catalogFor(e.name), k = LIFT_RATIO[c?.id];
      if (!k || seen.has(c.id)) continue;
      seen.add(c.id);
      const best = Math.max(0, ...e.sets.map(e1rm));
      if (best) vals.push(best / k);
    }
  }
  if (vals.length) return { v: vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)], from: 'record' };
  const bw = num(latestBody()?.weight) || (S.settings.profile.sex === 'female' ? 52 : 65);
  return { v: bw * (S.settings.profile.sex === 'female' ? 0.35 : 0.6), from: 'body' };
}
// やったことのない種目の、おすすめの重さ（kg）。自重・時間の種目は null
function estimateWeight(name, reps) {
  const c = catalogFor(name), k = LIFT_RATIO[c?.id];
  if (!k) return null;
  const top = parseInt(String(reps || c.reps || '10').split(/[-〜~]/).pop(), 10) || 10;
  // 目標の回数を2回ほど余力を残してできる重さ
  const w = benchLevel().v * k / (1 + (top + 2) / 30);
  return /ダンベル/.test(c.name) ? Math.max(1, Math.round(w)) : Math.max(2.5, round25(w));
}
function strengthText() {
  const map = new Map();
  for (const w of sortedWorkouts()) {
    for (const e of w.exercises) {
      const m = map.get(e.name) || { n: 0, best: 0 };
      m.n++;
      m.best = Math.max(m.best, ...e.sets.map(e1rm));
      m.last = { date: w.date, sets: e.sets };
      map.set(e.name, m);
    }
  }
  if (!map.size) return 'まだ記録なし';
  return [...map].map(([name, m]) => `${name}: 最近 ${m.last.date} ${setsText(m.last.sets)} / 推定最大 ${m.best ? r1(m.best) + 'kg' : '-'} / 記録${m.n}回`).join('\n');
}
function recentWorkoutsText() {
  const ws = sortedWorkouts().slice(-12);
  if (!ws.length) return 'まだ記録なし';
  return ws.map(w => `${w.date} ${w.dayName}: ` + [...w.exercises.map(e => `${e.name} ${setsText(e.sets)}`), ...(w.cardio?.length ? ['有酸素 ' + cardioText(w.cardio)] : [])].join(' / ')).join('\n');
}
function latestAnalysisText() {
  const a = S.analyses.at(-1);
  if (!a) return 'まだなし';
  const r = a.result;
  return `${a.date}の分析: ${r.overall}\n足りない部位: ${(r.weakPoints || []).map(w => `${w.part}（${w.detail}）`).join('、')}\n重点: ${(r.trainingFocus || []).join('、')}`;
}

// ===================== 続けるためのコメント =====================
// 心理の考え方: 小さな達成を認める / 前回の自分と比べる / 「全部かゼロか」にしない / 次の予定を具体的に決める
// ===================== 毎日の習慣（📌の種目を、ジムに行かない日も記録） =====================
function habitDays(name) {
  const set = new Set((S.habits || []).filter(x => normName(x.name) === normName(name)).map(x => x.date));
  for (const w of S.workouts) if (w.exercises?.some(e => normName(e.name) === normName(name) && e.sets.length)) set.add(w.date);
  return set;
}
function habitStreak(name) {
  const set = habitDays(name);
  let n = 0, d = set.has(ymd()) ? ymd() : addDays(ymd(), -1);
  while (n < 365 && set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function habitHtml() {
  return pinnedList().map(c => {
    const today = (S.habits || []).find(x => x.date === ymd() && normName(x.name) === normName(c.name));
    const inWorkout = S.workouts.some(w => w.date === ymd() && w.exercises?.some(e => normName(e.name) === normName(c.name) && e.sets.length));
    const streak = habitStreak(c.name);
    return `<div class="habit"><div class="small">🔁 <b>${h(c.name.replace(/（.*?）/, ''))}</b>
      ${today || inWorkout ? `<span class="tag">✅ 今日やった${today ? `（${today.sets.length}セット）` : ''}</span>` : ''}
      ${streak >= 2 ? `<span class="muted">${streak}日連続</span>` : ''}</div>
      <button class="btn sm" data-act="habitNew" data-id="${c.id}">${today ? '直す' : '＋ 記録'}</button></div>`;
  }).join('');
}
function habitSheet(c) {
  const today = (S.habits || []).find(x => x.date === ymd() && normName(x.name) === normName(c.name));
  const last = [...(S.habits || [])].filter(x => normName(x.name) === normName(c.name)).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  draft = { id: today?.id || uid(), name: c.name, sets: structuredClone(today?.sets || (last ? last.sets.map(() => ({ r: null })) : [{ r: null }, { r: null }, { r: null }])), last };
  openSheet(`${c.name.replace(/（.*?）/, '')}を記録`, `
    <p class="small">ジムに行かない日も、家でやった分をここに記録できます。${last ? `<br><span class="muted">前回 ${jpDate(last.date)}：${last.sets.map(x => x.r + '回').join(', ')}</span>` : ''}</p>
    <div id="habit-sets"></div>
    <button class="btn sm" data-act="habitAddSet">＋ セット</button>
    <button class="btn primary block" data-act="habitSave" style="margin-top:12px">記録する</button>`);
  renderHabitSets();
}
function renderHabitSets() {
  $('#habit-sets').innerHTML = `<table class="sets"><tr><th>セット</th><th>回数</th><th></th></tr>${draft.sets.map((x, i) => `<tr><td>${i + 1}</td>
    <td><input type="number" inputmode="numeric" data-in="habitSet" data-i="${i}" value="${x.r ?? ''}" placeholder="${draft.last?.sets[i]?.r ?? 10}"></td>
    <td><button class="icon-btn" data-act="habitDelSet" data-i="${i}" aria-label="セットを削除">−</button></td></tr>`).join('')}</table>`;
}

function weekStartOf(s) { const d = parseYmd(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return ymd(d); }
const weekCount = ws => new Set(strengthWorkouts().filter(w => weekStartOf(w.date) === ws).map(w => w.date)).size;
const weekTarget = () => num(S.settings.daysPerWeek) || 3;
function weekStreak() {
  let k = 0, ws = addDays(weekStartOf(ymd()), -7);
  while (k < 52 && weekCount(ws) >= weekTarget()) { k++; ws = addDays(ws, -7); }
  return k;
}
function mealStreak() {
  let n = 0, d = mealsOn(ymd()).length ? ymd() : addDays(ymd(), -1);
  while (n < 365 && mealsOn(d).length) { n++; d = addDays(d, -1); }
  return n;
}
// 毎日同じ言い回しにならないよう、日付で言い回しを選ぶ
function pick(key, arr) {
  let x = 0;
  for (const ch of ymd() + key) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return arr[x % arr.length];
}
function coachMessages() {
  const out = [];
  const add = (pri, icon, text) => out.push({ pri, icon, text });
  const sw = strengthWorkouts(), last = sw.at(-1), target = weekTarget();
  const done = weekCount(weekStartOf(ymd())), streak = weekStreak();
  const ts = trainStatus();
  if (!sw.length) add(9, '💡', '最初の1回は「30分・フォーム重視」でも十分です。まずは「ジムに行く」ことを習慣にするのが最初のゴール。');
  else {
    const gap = -daysUntil(last.date);
    if (gap > sessionGap() + 3) add(9, '🌱', `前回から${gap}日空きました。間が空いても大丈夫、大事なのは次の1回です。今日は「30分・フォーム重視」で体を慣らすだけでもOK。`);
    if (done >= target) add(8, '🎉', `今週は目標の${target}回を達成！${streak ? `${streak + 1}週連続です。` : ''}${pick('wk', ['この調子でいきましょう。', '続けている自分を誇っていいです。', '体は確実に変わり始めています。'])}`);
    else if (ts.state === 'done') add(7, '👏', pick('td', ['今日もジムに行けました。行動した自分をしっかり認めましょう。', '今日のがんばりは、確実に体に残っています。', 'やると決めた日にやれた。それが一番の才能です。']) + `（今週${done}/${target}回）`);
    else {
      const left = 7 - (new Date().getDay() + 6) % 7;
      if (target - done <= left) add(4, '📅', `今週はあと${target - done}回。次は${jpDate(ts.nextAt.date)}がおすすめ。行く日と時間を先に決めておくと、迷わず続けられます。`);
    }
    if (streak >= 2 && done < target) add(5, '🔥', `${streak}週連続で目標達成中。今週もつなげましょう。`);
  }
  for (const c of pinnedList()) {
    const hs = habitStreak(c.name);
    if (hs >= 3) add(5, '🔁', `${c.name.replace(/（.*?）/, '')}が${hs}日連続。毎日の小さな習慣が、いちばん体を変えます。`);
  }
  const ms = mealStreak();
  if (ms >= 2) add(5, '🍚', `食事の記録が${ms}日連続。${pick('ms', ['記録するだけで、食べ方は自然と整っていきます。', '続けていること自体が、もう成果です。', '自分の食事が見えるようになると、迷いが減ります。'])}`);
  if (!mealsOn(ymd()).length && new Date().getHours() >= 13) add(3, '📷', '今日の食事はまだ記録がありません。完璧じゃなくていいので、写真を1枚だけ撮ってみましょう。');
  const t = targets();
  if (t) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(ymd(), -(i + 1))).filter(d => mealsOn(d).length);
    const ok = days.filter(d => dayTotals(d).protein >= t.protein * 0.9).length;
    if (days.length >= 3 && ok >= days.length - 1) add(4, '💪', `たんぱく質はこの${days.length}日で${ok}日達成。筋肉づくりの土台ができています。`);
    else if (days.length >= 3 && ok <= days.length / 3) add(4, '🥚', 'たんぱく質が足りない日が多めです。まずは1食に1品、卵・納豆・サラダチキンなどを足すだけでOK。');
    const y = addDays(ymd(), -1);
    if (mealsOn(y).length && dayTotals(y).kcal > targetsOn(y).kcal * 1.15) add(5, '🙆', '昨日は少し食べすぎでも大丈夫。1日で体脂肪はほとんど変わりません。今日いつも通りに戻せば問題なしです。');
  }
  const ib = sortedBody().filter(b => b.source === 'inbody');
  if (ib.length >= 2) {
    const f = ib[0], l = ib.at(-1);
    const dfat = num(f.fatPct) - num(l.fatPct), dsm = num(l.skeletalMuscle) - num(f.skeletalMuscle);
    if (dfat >= 0.5) add(6, '📉', `体脂肪率は${jpDate(f.date)}から${r1(dfat)}%ダウン${dsm >= 0.3 ? `、骨格筋量は${r1(dsm)}kgアップ` : ''}。毎日の積み重ねが、ちゃんと数字に出ています。`);
  }
  const ws = sortedBody().filter(b => num(b.weight) != null).slice(-2);
  if (ws.length === 2 && Math.abs(num(ws[1].weight) - num(ws[0].weight)) >= 1) add(3, '⚖️', '体重は水分などで1日に1〜2kg上下します。一喜一憂せず、週の流れで見ましょう。');
  return out.sort((a, b) => b.pri - a.pri).slice(0, 3);
}
// トレーニングを保存した直後のコメント
function workoutPraise(w) {
  const lines = [];
  const sw = strengthWorkouts();
  if (sw.length === 1) lines.push('🎉 記念すべき最初の1回！始めた人だけが変われます。');
  const others = sw.filter(x => x.id !== w.id);
  let n = 0;
  for (const e of w.exercises) {
    if (n >= 2) break;
    const cur = Math.max(0, ...e.sets.map(e1rm));
    const prev = Math.max(0, ...others.flatMap(x => x.exercises.filter(y => normName(y.name) === normName(e.name)).flatMap(y => y.sets.map(e1rm))));
    const last = lastPerf(e.name, w.id);
    const topNow = Math.max(0, ...e.sets.map(s => num(s.w) || 0)), topLast = last ? Math.max(0, ...last.sets.map(s => num(s.w) || 0)) : 0;
    if (prev > 0 && cur > prev * 1.001) { lines.push(`🏆 ${e.name}で自己ベスト更新（推定最大 ${r1(cur)}kg）！`); n++; }
    else if (topLast > 0 && topNow > topLast) { lines.push(`📈 ${e.name}：前回より +${r1(topNow - topLast)}kg。成長しています。`); n++; }
  }
  const day = currentPlan().days.find(d => d.name === w.dayName);
  if (day && day.exercises.length && w.exercises.length >= adjustDay(day).exercises.length) lines.push('✅ メニューを最後までやり切りました。');
  const t = todayInput();
  if (t.minutes < (num(S.settings.weightMin) || 60)) lines.push('⏱ 時間が少ない日でもジムに来たことが一番えらい。「ゼロの日」を作らないことが習慣を作ります。');
  if (w.place === 'home') lines.push('🏠 ジムに行けない日でも、家でやり切りました。「できる形で続ける」ことが、いちばん強い習慣になります。');
  if (t.cond === 'tired' || t.cond === 'form') lines.push('🧘 体調に合わせて軽めにできたのも立派な判断。それが長く続けるためのいちばん賢いやり方です。');
  const done = weekCount(weekStartOf(w.date)), target = weekTarget();
  lines.push(done >= target ? `🎉 今週${done}回目で、週${target}回の目標を達成！` : `📊 今週${done}回目（目標は週${target}回）。`);
  const ts = trainStatus();
  lines.push(`📅 次は <b>${jpDate(ts.nextAt.date)}</b>（${menuLabel(ts.next)}）がおすすめ。「何曜日の何時に行く」まで決めておくと、続けやすくなります。`);
  lines.push(pick('cl', ['今日はたんぱく質をしっかりとって、よく眠りましょう。', '筋肉は休んでいる間に育ちます。今夜はゆっくり休んでください。', 'トレーニング後の食事はご飯もしっかり。回復が早くなります。']));
  return lines;
}

// ===================== 画面の切り替え =====================
let tab = 'home';
let mealDate = ymd();
let draft = null; // 入力中のシートの中身

function render() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const st = S.settings;
  const d = daysUntil(targetDate());
  $('#header-sub').textContent = d >= 0 ? `目標の期限まであと${d}日` : '';
  $('#view').innerHTML = VIEWS[tab]();
  window.scrollTo(0, 0);
}

const VIEWS = {
  home() {
    const st = S.settings;
    const t = targetsOn(ymd());
    const tot = dayTotals(ymd());
    const b = latestBody();
    const g = absGuide();
    const next = nextPlanDay();
    const lastW = sortedWorkouts().at(-1);
    let html = '';
    const hkDays = st.lastHealthImport ? -daysUntil(st.lastHealthImport) : null;
    if (st.healthSetup && hkDays >= 5) {
      html += `<div class="notice"><b>⌚ Apple Watchの記録を${hkDays}日取り込んでいません</b>（最後：${jpDate(st.lastHealthImport)}）<br>
        ショートカットは直近7日分しか読めないので、早めに取り込みましょう。下のボタンでショートカットを実行して、戻ってきたら「取り込む」を押してください。
        <button class="btn sm" data-act="runShortcut" style="margin-top:6px">🔄 ショートカットを実行して取り込む</button></div>`;
    }
    if (!st.apiKey || !st.profile.sex || !st.profile.height) {
      html += `<div class="notice"><b>はじめに設定をしましょう</b><br>${!st.apiKey ? '・写真のAI分析に使う「APIキー」<br>' : ''}${!st.profile.sex || !st.profile.height ? '・性別と身長（カロリー計算に使います）<br>' : ''}
        <button class="btn sm" data-act="go" data-tab="settings" style="margin-top:6px">設定を開く</button></div>`;
    }
    const coach = coachMessages();
    if (coach.length) html += `<div class="card coach"><h3>💬 今日のひとこと</h3>${coach.map(c => `<p class="small">${c.icon} ${c.text}</p>`).join('')}</div>`;
    // 食事
    html += `<div class="card sec">${secHead('🍚', '食事', 'meals')}
      ${t ? bar('カロリー', tot.kcal, t.kcal, 'kcal') + bar('たんぱく質', tot.protein, t.protein, 'g')
        : '<p class="muted">体重を一度記録すると、1日の目標カロリーが出ます。</p>'}
      ${t ? `<p class="muted">あと ${r0(Math.max(0, t.kcal - tot.kcal))} kcal・たんぱく質 ${r0(Math.max(0, t.protein - tot.protein))} g${t.extra ? `（${[t.ride ? `自転車 ${t.ride}kcal` : '', t.cardio ? `有酸素 ${t.cardio}kcal` : ''].filter(Boolean).join('・')} を目標に足しています）` : ''}</p>` : ''}
      ${weekBalanceHtml(true)}
      ${usualBreakfastBtn()}
      ${nextMealHtml(true)}
      <div class="grid3 sec-btns">
        <button class="btn primary" data-act="mealPhoto">📷 撮る</button>
        <button class="btn" data-act="mealText">✏️ 文字で</button>
        <button class="btn" data-act="shareNew">🍻 会食</button>
      </div></div>`;
    // 体
    const ib = sortedBody().filter(x => x.source === 'inbody');
    const diff = (k, u) => { const v = num(ib.at(-1)[k]) - num(ib[0][k]); return Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${r1(Math.abs(v))}${u}` : '-'; };
    html += `<div class="card sec">${secHead('⚖️', '体', 'body')}
      ${b ? `<div class="grid3">
        <div class="stat"><b>${r1(num(b.weight))}</b><span>体重 kg</span></div>
        <div class="stat"><b>${r1(num(b.fatPct))}</b><span>体脂肪率 %</span></div>
        <div class="stat"><b>${r1(num(b.skeletalMuscle ?? b.muscle))}</b><span>${b.skeletalMuscle != null ? '骨格筋量' : '筋肉量'} kg</span></div>
      </div><p class="muted" style="text-align:center">${jpDate(b.date)}・${SOURCES[b.source] || ''}</p>` : '<p class="muted">まだ記録がありません。</p>'}
      ${ib.length >= 2 ? `<div class="hint small">InBody ${jpDate(ib[0].date)}から：体重 <b>${diff('weight', 'kg')}</b>・体脂肪率 <b>${diff('fatPct', '%')}</b>・骨格筋量 <b>${diff('skeletalMuscle', 'kg')}</b></div>
        <p class="small chart-title">体重（InBody）</p>${lineChart(ib.slice(-20).filter(x => num(x.weight) != null).map(x => ({ d: x.date, y: num(x.weight), id: x.id })), 'kg', 'var(--accent)')}
        <p class="small chart-title">体脂肪率（InBody）</p>${lineChart(ib.slice(-20).filter(x => num(x.fatPct) != null).map(x => ({ d: x.date, y: num(x.fatPct), id: x.id })), '%', 'var(--chart2)')}` : ''}
      <div class="grid2 sec-btns">
        <button class="btn" data-act="bodyQuick">⚖️ 体重を記録</button>
        <button class="btn" data-act="bodyReadPhoto" data-src="inbody">📱 InBody</button>
      </div></div>`;
    // トレーニング
    const ts = trainStatus();
    html += `<div class="card sec">${secHead('🏋️', 'トレーニング', 'train')}
      ${ts.state === 'go' ? `<p class="small">💪 今日のメニュー：<b>${menuLabel(ts.today)} ${h(dayTitle(ts.today))}</b></p>`
      : `<p class="small">${ts.state === 'done' ? '✅ 今日はトレーニング済み。' : '🛌 今日は休養日。'}体を休ませて超回復を待ちましょう。</p>`}
      <p class="small">📅 次回：<b>${jpDate(ts.nextAt.date)}</b> に ${menuLabel(ts.next)} ${h(dayTitle(ts.next))}</p>
      <p class="muted">今週 ${weekCount(weekStartOf(ymd()))}/${weekTarget()}回${lastW ? ` ・ 前回 ${jpDate(lastW.date)}` : ''}</p>
      ${habitHtml()}
      <div class="grid2 sec-btns">
        <button class="btn ${ts.state === 'go' ? 'primary' : ''}" data-act="startWorkout">🏋️ 記録する</button>
        <button class="btn" data-act="go" data-tab="train">メニューを見る</button>
      </div></div>`;
    // 移動・有酸素
    html += rideCardHtml();
    // 目標
    html += `<div class="card"><h3>🎯 目標</h3><ul class="plain small">${st.goals.map(x => `<li>${h(x)}</li>`).join('')}</ul>
      <p class="muted">期限：${ymdText(targetDate())}（あと${daysUntil(targetDate())}日）</p>
      ${targetHtml()}
      ${g ? absGuideHtml(g) : ''}
      <button class="btn sm" data-act="go" data-tab="settings" style="margin-top:6px">目標の数値を決める・AIに相談</button></div>`;
    return html;
  },

  meals() {
    const t = targetsOn(mealDate);
    const tot = dayTotals(mealDate);
    const ms = mealsOn(mealDate);
    let html = `<div class="datenav">
      <button class="btn sm" data-act="mealDay" data-d="-1">‹ 前の日</button>
      <b>${mealDate === ymd() ? '今日 ' : ''}${jpDate(mealDate)}</b>
      <button class="btn sm" data-act="mealDay" data-d="1" ${mealDate >= ymd() ? 'disabled' : ''}>次の日 ›</button>
    </div>`;
    // 記録ボタンはいつも一番上に
    html += `<div class="card record-box"><h3>✍️ 食事を記録する</h3>
      <div class="btn-grid" style="margin-bottom:8px">
        <button class="btn primary" data-act="mealPhoto">📷 写真で記録</button>
        <button class="btn" data-act="mealText">✏️ 文字で記録</button>
        <button class="btn" data-act="mealFav">⭐ お気に入りから</button>
        <button class="btn" data-act="mealManual">＋ 手で入力</button>
      </div>
      <button class="btn block" data-act="shareNew">🍻 みんなで食べた（会食・分け合い）</button>
      ${mealDate === ymd() ? usualBreakfastBtn() : ''}
    </div>`;
    html += `<div class="card">
      ${bar('カロリー', tot.kcal, t?.kcal, 'kcal')}
      ${bar('たんぱく質', tot.protein, t?.protein, 'g')}
      ${bar('脂質', tot.fat, t?.fat, 'g')}
      ${bar('炭水化物', tot.carbs, t?.carbs, 'g')}
      ${t?.extra ? `<p class="muted">🚲🏃 この日の${[t.ride ? `自転車 ${t.ride}kcal` : '', t.cardio ? `有酸素 ${t.cardio}kcal` : ''].filter(Boolean).join('・')} 分を目標に足しています</p>` : ''}
      ${mealDate === ymd() ? nextMealHtml(false) : ''}
    </div>`;
    if (mealDate === ymd()) html += weekBalanceHtml(false);
    for (const [type, label] of MEAL_TYPES) {
      const list = ms.filter(m => m.type === type);
      if (!list.length) continue;
      html += `<div class="card"><div class="spread"><h3>${label}</h3><span class="muted">${r0(sum(list, 'kcal'))} kcal</span></div><ul class="list">
        ${list.map(m => `<li class="tap" data-act="mealEdit" data-id="${m.id}">
          ${m.thumb ? `<img class="thumb" src="${m.thumb}" alt="">` : '<div class="thumb"></div>'}
          <div class="grow"><div class="title">${h(m.name)}</div>
          <div class="muted">${r0(m.kcal)} kcal ・ P ${r0(m.protein)} / F ${r0(m.fat)} / C ${r0(m.carbs)}</div></div>
        </li>`).join('')}</ul></div>`;
    }
    if (!ms.length) html += '<p class="muted" style="text-align:center">この日の記録はまだありません。</p>';
    html += '<p class="muted">P＝たんぱく質、F＝脂質、C＝炭水化物（g）。写真からの推定は2〜3割ほどずれることがあります。</p>';
    return html;
  },

  body() {
    const list = sortedBody();
    const g = absGuide();
    let html = `<div class="btn-grid">
      <button class="btn primary" data-act="bodyReadPhoto" data-src="inbody">📱 InBodyを取り込む</button>
      <button class="btn" data-act="bodyReadPhoto" data-src="tanita">📷 家庭の体重計を読む</button>
    </div>
    <button class="btn block" data-act="bodyManual" style="margin-bottom:12px">✏️ 数値を手で入力</button>`;
    if (g) html += `<div class="card"><h3>腹筋が見えるまでの目安</h3>${absGuideHtml(g)}</div>`;
    if (list.length >= 2) {
      const last = list.slice(-60);
      html += `<div class="card"><h3>体重の変化</h3>${lineChart(last.filter(b => num(b.weight) != null).map(b => ({ d: b.date, y: num(b.weight), id: b.id })), 'kg', 'var(--accent)')}
        <h3 style="margin-top:12px">体脂肪率の変化</h3>
        <div class="legend"><span><i style="background:var(--accent)"></i>InBody</span><span><i style="background:var(--chart2)"></i>家庭の体重計</span></div>
        ${lineChart(last.filter(b => num(b.fatPct) != null && b.source === 'inbody').map(b => ({ d: b.date, y: num(b.fatPct), id: b.id })), '%', 'var(--accent)',
          last.filter(b => num(b.fatPct) != null && b.source !== 'inbody').map(b => ({ d: b.date, y: num(b.fatPct), id: b.id })))}
        <p class="muted">InBodyと家庭の体重計は測り方が違うので、体脂肪率は同じ機械どうしで比べてください。</p></div>`;
    }
    html += `<div class="card"><div class="spread"><h3>体の写真で分析</h3></div>
      <p class="small">体の写真から、目標に対して足りない部位と、重点的にやるトレーニングをAIが提案します。月に1回くらい、同じ場所・同じ明るさで撮ると変化がわかりやすいです。</p>
      <button class="btn primary block" data-act="bodyAnalyze">📷 体の写真を撮って分析</button>
      ${S.analyses.length ? `<h4>これまでの分析</h4><p class="muted" style="margin-top:0">人に見られないよう、写真は日付をタップしたときだけ表示します。</p><ul class="list">${[...S.analyses].reverse().map(a => `
        <li class="tap" data-act="analysisView" data-id="${a.id}">
          <div class="grow"><div class="title">${jpDate(a.date)}</div><div class="muted">${h((a.result.overall || '').slice(0, 40))}…</div></div>
        </li>`).join('')}</ul>` : ''}
    </div>`;
    html += `<div class="card"><h3>測定の記録</h3>${list.length ? `<ul class="list">${[...list].reverse().map(b => `
      <li class="tap" data-act="bodyEdit" data-id="${b.id}"><div class="grow">
        <div class="title">${jpDate(b.date)} <span class="tag src-${b.source}">${SOURCES[b.source] || ''}</span></div>
        <div class="muted">${r1(num(b.weight))} kg ・ 体脂肪 ${r1(num(b.fatPct))} % ${num(b.skeletalMuscle) != null ? `・ 骨格筋 ${r1(num(b.skeletalMuscle))} kg` : num(b.muscle) != null ? `・ 筋肉 ${r1(num(b.muscle))} kg` : ''}</div>
      </div></li>`).join('')}</ul>` : '<p class="muted">まだ記録がありません。</p>'}</div>`;
    return html;
  },

  train() {
    const plan = currentPlan();
    const ws = sortedWorkouts().reverse();
    const ts = trainStatus();
    const home = todayInput().place === 'home';
    let html = recordBoxHtml();
    // 今日のメニュー
    if (ts.state === 'go') {
      html += `<div class="card day-card"><h3>💪 今日のメニュー</h3>${todayAdjustHtml()}${dayCardHtml(adjustDay(ts.today), { primary: true, today: true, buttonText: 'このメニューで記録を始める' })}</div>`;
    } else if (ts.state === 'done') {
      html += `<div class="card rest-card"><h3>✅ 今日のメニュー：トレーニング済み</h3>
        <p class="small">今日は「${h(ts.todayW.dayName)}」をやりました。おつかれさまでした！<br>今日は<b>体を休ませて、超回復を待ちましょう</b>。${SUPER}</p>
        <ul class="plain small"><li>たんぱく質をしっかり（今日の目標までとりましょう）</li><li>睡眠は7時間くらいとると回復が早くなります</li></ul>
        ${placeSegHtml()}${home ? dayCardHtml(adjustDay(ts.next), { primary: true, today: true, buttonText: '宅トレで記録を始める' }) : ''}</div>`;
    } else {
      html += `<div class="card rest-card"><h3>🛌 今日のメニュー：休養日</h3>
        <p class="small">前回（${jpDate(ts.last.date)}「${h(ts.last.dayName)}」）で使った筋肉を休ませて、<b>超回復を待ちましょう</b>。${SUPER}</p>
        <p class="small">次は <b>${jpDate(ts.nextAt.date)}</b> がおすすめです。</p>
        ${placeSegHtml()}${home ? dayCardHtml(adjustDay(ts.next), { primary: true, today: true, buttonText: '宅トレで記録を始める' }) : ''}</div>`;
    }
    // 次回のメニュー
    html += `<div class="card day-card"><div class="spread"><h3>📅 次回のメニュー</h3></div>
      <p class="small" style="margin-top:0"><b>${jpDate(ts.nextAt.date)}</b> に行くのがおすすめ${ts.nextAt.why ? `<span class="muted">（${h(ts.nextAt.why)}から計算）</span>` : ''}</p>
      ${dayCardHtml(ts.next, { compact: ts.state === 'go', button: ts.state !== 'go' })}</div>`;
    // すべてのメニュー
    html += `<div class="card"><details><summary>すべてのメニューを見る（${plan.days.length}種類を順番に回します）</summary>
      <p class="muted">メニューA→B→C…の順にくり返します。曜日は決めず、行った日に「今日のメニュー」をやればOK。休んだ日があっても続きから始まります。</p>
      <p class="muted">${plan.source === 'ai' ? `AI作成 ${h(plan.createdAt)}` : '基本メニュー'} ・ 時間：${sessionText()}（設定で変更）</p>
      ${plan.days.map(d => `<div class="sub-day">${dayCardHtml(d, { compact: true })}</div>`).join('')}
    </details></div>`;
    const cl = chosenList();
    html += `<div class="card"><h3>やりたい種目を選ぶ</h3>
      <p class="small">${cl.length}種目を選択中（${PARTS.map(([k, l]) => [l, cl.filter(c => c.part === k).length]).filter(x => x[1]).map(([l, n]) => `${l}${n}`).join('・') || 'なし'}）</p>
      <p class="muted">種目ごとに「どこに効くか」「どんな変化が期待できるか」を見ながら選べます。基本メニューもAIのメニューも、選んだ種目だけで作ります。</p>
      <button class="btn block" data-act="pickExercises">📋 種目を選ぶ・効果を見る</button></div>`;
    html += `<div class="card"><h3>筋トレメモから取り込む</h3>
      <p class="small">筋トレメモの記録画面を画面収録（またはスクショ）すると、AIが種目・重さ・回数を読み取ります。今の実力をもとに、AIが重さまで提案できるようになります。</p>
      <button class="btn block" data-act="kmemoGuide">📱 筋トレメモの記録を取り込む</button></div>`;
    html += `<div class="card">
      ${plan.tips?.length ? `<h3>アドバイス</h3><ul class="plain small">${plan.tips.map(t => `<li>${h(t)}</li>`).join('')}</ul>` : ''}
      <div class="grid2" style="margin-top:10px">
        <button class="btn primary" data-act="planAI">🤖 AIで作り直す</button>
        <button class="btn" data-act="planDefault">基本メニューに戻す</button>
      </div>
      <p class="muted">AIは、目標・体のデータ・体の写真の分析・これまでの記録・使える器具をもとにメニューを作ります。</p>
    </div>`;
    html += `<div class="card"><h3>トレーニングの記録</h3>${ws.length ? `<ul class="list">${ws.map(w => `
      <li class="tap" data-act="workoutEdit" data-id="${w.id}"><div class="grow">
        <div class="title">${jpDate(w.date)} ${w.place === 'home' ? '🏠 ' : ''}${h(w.dayName)}${w.place === 'home' ? '（宅トレ）' : ''}</div>
        <div class="muted">${[w.exercises.length ? `${w.exercises.length}種目 ・ ${w.exercises.reduce((a, e) => a + e.sets.length, 0)}セット` : '', w.cardio?.length ? `有酸素 ${w.cardio.reduce((a, c) => a + (num(c.min) || 0), 0)}分` : ''].filter(Boolean).join(' ・ ')}</div>
      </div></li>`).join('')}</ul>` : '<p class="muted">まだ記録がありません。</p>'}</div>`;
    return html;
  },

  settings() {
    const st = S.settings, p = st.profile, t = targets();
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${h(l)}</option>`).join('');
    return `<div class="card"><h3>AI（Google Gemini）の設定</h3>
      <p class="small">写真の分析には Google の無料AI「Gemini」を使います。下の手順で「APIキー」（AIを使うための合言葉のような文字列）を取ってきて貼り付けてください。</p>
      <ol class="small">
        <li>下のボタンで Google AI Studio を開き、Googleアカウントでログイン</li>
        <li>「APIキーを作成（Create API key）」を押す</li>
        <li>出てきた文字列（AIza…で始まる）をコピーして、下の欄に貼り付け</li>
      </ol>
      <a class="btn sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio を開く</a>
      <label class="field">APIキー<input type="password" data-set="apiKey" value="${h(st.apiKey)}" placeholder="AIza..." autocomplete="off"></label>
      <label class="field">AIの種類（うまく動かないときに変えてみてください）<select data-set="model">${opt(MODELS.map(m => [m, m]), st.model)}</select></label>
      <button class="btn sm" data-act="testKey">接続テスト</button>
      <div class="notice">無料枠では、送った写真や文章がGoogleのAI改善に使われることがあります。体の写真は<b>顔を写さず</b>、トレーニングウェアなどで撮るのがおすすめです。APIキーはこのiPhoneの中にだけ保存されます。</div>
    </div>

    <div class="card"><h3>プロフィール</h3>
      <div class="grid2">
        <label class="field">性別（計算用）<select data-set="profile.sex">${opt([['', '選んでください'], ['male', '男性'], ['female', '女性']], p.sex)}</select></label>
        <label class="field">生まれた年<input type="number" inputmode="numeric" data-set="profile.birthYear" value="${h(p.birthYear)}" placeholder="例: 1995"></label>
      </div>
      <label class="field">身長（cm）<input type="number" inputmode="decimal" data-set="profile.height" value="${h(p.height)}" placeholder="例: 172"></label>
      <label class="field">ふだんの活動量<select data-set="profile.activity">${opt(ACTIVITY, p.activity)}</select></label>
    </div>

    <div class="card"><h3>目標</h3>
      <label class="field">なりたい体（1行に1つ）<textarea data-set="goals">${h(st.goals.join('\n'))}</textarea></label>
      <label class="field">期限の決め方<select data-set="targetMode">${opt([['months', '今日から◯ヶ月後'], ['date', '日付で指定']], st.targetMode)}</select></label>
      ${st.targetMode === 'months'
        ? `<label class="field">期間<select data-set="targetMonths">${opt([1, 2, 3, 4, 6, 9, 12].map(m => [m, m === 12 ? '1年後' : `${m}ヶ月後`]), st.targetMonths)}</select></label>
          <p class="muted">${jpDate(st.targetBase)}から数えて <b>${ymdText(targetDate())}</b> まで（あと${daysUntil(targetDate())}日）。期間を変えると、その日から数え直します。
          <button class="btn sm" data-act="targetRestart" style="margin-top:4px">今日から数え直す</button></p>`
        : `<label class="field">期限の日付${dateBox('data-set="targetDate"', targetDate())}</label>`}
      <label class="field">今の方針<select data-set="mode">${opt(MODES, st.mode)}</select></label>
      <label class="field">週のトレーニング回数<select data-set="daysPerWeek">${opt([[2, '週2回'], [3, '週3回'], [4, '週4回']], st.daysPerWeek)}</select></label>
      <label class="field">ジムでやること<select data-set="sessionMode">${opt(SESSION_MODES, st.sessionMode)}</select></label>
      <div class="grid2">
        ${st.sessionMode !== 'cardio' ? `<label class="field">ウェイトの時間（分）<input type="number" inputmode="numeric" data-set="weightMin" value="${h(st.weightMin)}"></label>` : ''}
        ${st.sessionMode !== 'weights' ? `<label class="field">有酸素の時間（分）<input type="number" inputmode="numeric" data-set="cardioMin" value="${h(st.cardioMin)}"></label>` : ''}
      </div>
      <p class="muted">→ ${sessionText()}。AIのメニューも基本メニューも、この時間に収まるように組みます。自転車の移動はここに含めなくて大丈夫です。</p>
      <p class="muted">目標を達成したら、ここを書き換えればそのまま使い続けられます（例: 方針を「増量」にして胸をさらに大きく）。</p>
      <h4>目標の数値</h4>
      ${targetHtml()}
      ${st.target?.reason ? `<div class="hint small">💬 ${h(st.target.reason)}${st.target.weeklyPace ? `<br>ペース：${h(st.target.weeklyPace)}` : ''}${st.target.steps?.length ? `<ul class="plain">${st.target.steps.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      <button class="btn primary block" data-act="targetAI" style="margin-top:8px">🤖 目標の言葉からAIに提案してもらう</button>
      <div class="grid2">
        <label class="field">目標の体重（kg）<input type="number" inputmode="decimal" data-target="weight" value="${h(st.target?.weight ?? '')}" placeholder="${h(targetValues()?.weight ?? '')}"></label>
        <label class="field">目標の体脂肪率（%）<input type="number" inputmode="decimal" data-target="fatPct" value="${h(st.target?.fatPct ?? '')}" placeholder="${h(targetValues()?.fatPct ?? '')}"></label>
      </div>
      <p class="muted">空欄なら計算の目安を使います。自分で入れた数字が優先されます。</p>
    </div>

    <div class="card"><h3>1日の目標（自動計算）</h3>
      ${t ? `<div class="grid2 small">
        <div>カロリー: <b>${r0(t.kcal)} kcal</b></div><div>たんぱく質: <b>${r0(t.protein)} g</b></div>
        <div>脂質: <b>${r0(t.fat)} g</b></div><div>炭水化物: <b>${r0(t.carbs)} g</b></div>
      </div>
      <p class="muted">基礎代謝 ${r0(t.bmr)} kcal（${t.how}）× 活動量 → 1日の消費 約${r0(t.tdee)} kcal。${st.mode === 'cut' ? 'そこから約400kcal減らしています。' : st.mode === 'bulk' ? 'そこに約250kcal足しています。' : ''}たんぱく質は体重×2g。</p>`
        : '<p class="muted">体重を記録すると計算されます。</p>'}
      <h4>自分で決めたい場合（空欄なら自動）</h4>
      <div class="grid2">
        <label class="field">カロリー<input type="number" inputmode="numeric" data-set="override.kcal" value="${h(st.override.kcal)}" placeholder="自動"></label>
        <label class="field">たんぱく質 g<input type="number" inputmode="numeric" data-set="override.protein" value="${h(st.override.protein)}" placeholder="自動"></label>
      </div>
    </div>

    <div class="card"><h3>自転車</h3>
      <label class="field">ふだん乗る自転車<select data-set="bike">${opt(BIKES, st.bike)}</select></label>
      <h4>よく使うルート</h4>
      ${st.routes.length ? `<ul class="list">${st.routes.map((r, i) => `<li><div class="grow"><div class="title">${h(r.name)}</div><div class="muted">${r1(r.km)}km${r.round ? '（往復）' : ''}</div></div>
        <button class="icon-btn" data-act="routeDelete" data-i="${i}" aria-label="ルートを削除">🗑</button></li>`).join('')}</ul>`
        : '<p class="muted">自転車の記録画面で「よく使うルートとして保存」を選ぶと、ここに追加されます。</p>'}
    </div>

    <div class="card"><h3>Apple Watch</h3>
      <p class="small">サイクリングの記録を、フィットネスアプリのスクショか、ショートカットで取り込めます。ショートカットの作り方もこの中にあります。</p>
      <button class="btn block" data-act="healthImport">⌚ 取り込み方・ショートカットの作り方を見る</button>
      <label class="field">ショートカットの名前（bodymakeのボタンから実行するときに使います）<input data-set="shortcutName" value="${h(st.shortcutName)}"></label>
    </div>

    <div class="card"><h3>ジムで使える器具</h3>
      ${EQUIPMENT.map(([k, l]) => `<label class="check"><input type="checkbox" data-eq="${k}" ${st.equipment.includes(k) ? 'checked' : ''}>${h(l)}</label>`).join('')}
      <label class="field">ふだんの重さの単位（記録画面でジムごとに切り替えもできます）<select data-set="unit">${opt([['kg', 'kg（キログラム）'], ['lb', 'lb（ポンド）']], st.unit)}</select></label>
    </div>

    <div class="card"><h3>データの保存（バックアップ）</h3>
      <p class="small">記録はこのiPhoneの中だけに保存されています。機種変更や万一に備えて、ときどき書き出しておくと安心です。</p>
      <div class="grid2">
        <button class="btn" data-act="exportData">書き出す</button>
        <button class="btn" data-act="importData">読み込む</button>
      </div>
    </div>
    <p class="muted">このアプリの提案は一般的な目安で、医療的な診断ではありません。体調に不安があるときは専門家に相談してください。</p>`;
  },
};

const secHead = (icon, title, tabName) => `<div class="sec-head"><h3>${icon} ${title}</h3><button class="link-btn" data-act="go" data-tab="${tabName}">くわしく ›</button></div>`;
function bar(label, val, target, unit) {
  const pct = target ? Math.min(100, (val / target) * 100) : 0;
  const over = target && val > target * 1.05;
  return `<div class="bar"><div class="bar-top"><span>${label}</span><span><b>${r0(val)}</b> / ${target ? r0(target) : '–'} ${unit}</span></div>
    <div class="bar-track"><div class="bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div></div>`;
}

function absGuideHtml(g) {
  const label = g.custom ? '目標の体脂肪率' : '腹筋が見えてくる目安の体脂肪率';
  if (g.toLose <= 0.1) return `<div class="hint">体脂肪率 ${r1(g.pct)}% で、${label}（${g.goalPct}%）に届いています！ 腹筋種目で凹凸をはっきりさせましょう。</div>`;
  return `<div class="hint">${label}は <b>${g.goalPct}%</b>。今は ${r1(g.pct)}%（${SOURCES[g.source] || ''}）なので、あと<b>約${r1(g.toLose)}kg</b>の脂肪を落とすイメージです。<br>
    ${g.custom ? '' : `体重でいうと <b>${r1(g.w)}kg → 約${r1(g.goalW)}kg</b>（筋肉の量はそのままの場合）。<br>`}
    期限までだと<b>週${r1(g.perWeek)}kg</b>ペース。${g.safe ? '無理のないペースです。' : '少し急なペースです。期限までに全部は難しくても、近づけば腹筋の上の方から見えてきます。焦って食事を減らしすぎないように。'}</div>`;
}

// タップした位置に一番近い点を探すため、描いたグラフの点を覚えておく
const CHARTS = {};
let chartSeq = 0;
function lineChart(pts, unit, color, pts2 = []) {
  const all = [...pts, ...pts2];
  if (all.length < 2) return '<p class="muted">2回以上記録するとグラフが出ます。</p>';
  const W = 320, H = 130, L = 34, R = 10, T = 10, B = 22;
  const dates = [...new Set(all.map(p => p.d))].sort();
  const ys = all.map(p => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const x = d => L + (dates.length === 1 ? 0 : (dates.indexOf(d) / (dates.length - 1)) * (W - L - R));
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = (ps, c) => ps.length ? `<polyline fill="none" stroke="${c}" stroke-width="2" points="${ps.map(p => `${x(p.d)},${y(p.y)}`).join(' ')}"/>
    ${ps.map(p => `<circle cx="${x(p.d)}" cy="${y(p.y)}" r="2.5" fill="${c}"/>`).join('')}` : '';
  const md = d => { const t = parseYmd(d); return `${t.getMonth() + 1}/${t.getDate()}`; };
  const id = 'ch' + (++chartSeq);
  CHARTS[id] = { W, unit, pts: all.map(p => ({ ...p, vx: x(p.d), vy: y(p.y) })) };
  return `<svg class="chart tap" viewBox="0 0 ${W} ${H}" role="img" aria-label="${unit}の変化" data-act="chartTap" data-chart="${id}">
    <line class="ax" x1="${L}" x2="${W - R}" y1="${y(hi)}" y2="${y(hi)}"/>
    <line class="ax" x1="${L}" x2="${W - R}" y1="${y(lo)}" y2="${y(lo)}"/>
    <text x="${L - 4}" y="${y(hi) + 3}" text-anchor="end">${r1(hi)}</text>
    <text x="${L - 4}" y="${y(lo) + 3}" text-anchor="end">${r1(lo)}</text>
    <text x="${L}" y="${H - 6}">${md(dates[0])}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end">${md(dates.at(-1))}</text>
    <line class="sel-line" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    ${line(pts, color)}${line(pts2, 'var(--chart2)')}
    <circle class="sel-dot" cx="0" cy="0" r="5.5" visibility="hidden"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
  </svg>
  <div class="chart-tip" id="tip-${id}">👆 グラフをタップすると、その日の数値が出ます</div>`;
}
function bodyTipText(b) {
  const parts = [num(b.weight) != null && `体重 <b>${r1(num(b.weight))}kg</b>`, num(b.fatPct) != null && `体脂肪率 <b>${r1(num(b.fatPct))}%</b>`,
    num(b.skeletalMuscle) != null ? `骨格筋量 ${r1(num(b.skeletalMuscle))}kg` : num(b.muscle) != null && `筋肉量 ${r1(num(b.muscle))}kg`].filter(Boolean);
  return `<b>${jpDate(b.date)}</b> <span class="tag src-${b.source}">${SOURCES[b.source] || ''}</span><br>${parts.join('・')}`;
}

// ===================== 次の食事の提案 =====================
// よくある食事 [名前, 種類, kcal, たんぱく質, 脂質, 炭水化物]（1人前のおおよその値）
const DISHES = [
  ['焼き魚定食（鮭）', '外食・自炊', 600, 35, 18, 75], ['刺身定食', '外食', 550, 35, 8, 80], ['サバの味噌煮定食', '外食', 750, 30, 30, 80],
  ['鶏むね肉のソテー＋ご飯半膳＋サラダ', '自炊', 550, 40, 12, 60], ['豚しゃぶサラダ＋ご飯小盛り', '自炊', 500, 30, 18, 50],
  ['豆腐ハンバーグ＋ご飯小盛り＋味噌汁', '自炊', 550, 28, 20, 60], ['冷奴＋納豆＋味噌汁＋ご飯', '自炊', 500, 25, 14, 70],
  ['鶏肉と野菜の鍋（しめなし）', '自炊', 400, 35, 15, 20], ['親子丼', '外食・自炊', 650, 30, 15, 95], ['牛丼（並）', '外食', 650, 20, 25, 90],
  ['焼肉（赤身中心）＋ご飯小盛り', '外食', 700, 40, 35, 50], ['唐揚げ定食', '外食', 900, 35, 45, 90], ['とんかつ定食', '外食', 1000, 35, 50, 100],
  ['野菜炒め定食', '外食', 700, 20, 30, 85], ['寿司（10貫）', '外食', 550, 25, 8, 90], ['とろろそば', '外食', 450, 18, 4, 85],
  ['ラーメン', '外食', 800, 25, 30, 100], ['カレーライス', '外食・自炊', 800, 20, 25, 120],
  ['サラダチキン＋野菜スープ＋おにぎり1個', 'コンビニ', 400, 30, 5, 55], ['おでん（卵・大根・ちくわ・こんにゃく）', 'コンビニ', 250, 20, 8, 25],
  ['焼き鳥（塩・5本）＋サラダ', '外食・コンビニ', 450, 35, 22, 15], ['ギリシャヨーグルト＋ゆで卵2個', 'コンビニ', 250, 25, 10, 12],
];
// 次に何を食べる番か: 夕ごはんが未記録なら、お昼を食べた（または15時以降）なら夕ごはん、それ以外はお昼ごはん
function nextMealContext() {
  const t = targetsOn(ymd());
  if (!t) return null;
  const ms = mealsOn(ymd()), has = type => ms.some(m => m.type === type);
  if (has('dinner')) return null;
  const meal = has('lunch') || new Date().getHours() >= 15 ? 'dinner' : 'lunch';
  const tot = dayTotals(ymd());
  // お昼のときは、夕ごはんの分を残すために残りの約半分を目安にする
  const share = meal === 'lunch' ? 0.5 : 1;
  const left = k => Math.max(0, (t[k] - tot[k]) * share);
  return { meal, label: meal === 'lunch' ? 'お昼ごはん' : '夕ごはん', kcal: left('kcal'), protein: left('protein'), fat: left('fat'), carbs: left('carbs'), share };
}
function mealAdvice(c) {
  const tips = [];
  if (c.kcal < 300) tips.push('残りが少なめです。汁物やサラダ、たんぱく質中心で軽めにしましょう。');
  if (c.fat < 12) tips.push('🛢 脂質が残り少ないので、揚げ物は控えて「焼く・蒸す・煮る」料理に。');
  else if (c.fat >= 30 && c.kcal >= 800) tips.push('🍗 今日は脂質に余裕があるので、揚げ物も食べてOK。');
  if (c.protein >= 35) tips.push('💪 たんぱく質がまだ足りていません。鶏むね・魚・豆腐・卵などをメインに。');
  if (c.carbs < 40) tips.push('🍚 ご飯は半膳くらいに。');
  else if (c.carbs >= 90) tips.push('🍚 ご飯は普通盛りでOK。');
  return tips;
}
function dishPicks(c) {
  // 残りのカロリーと脂質に収まるものから、たんぱく質がとれて残りに近いものを選ぶ
  const ok = DISHES.filter(d => d[2] <= c.kcal + 50 && d[4] <= c.fat + 8);
  const score = d => -Math.abs(c.kcal - d[2]) / 10 - Math.max(0, c.protein - d[3]) * 1.5 + d[3] * 0.3;
  const picks = [...ok].sort((a, b) => score(b) - score(a)).slice(0, 3);
  return picks.length ? picks : [...DISHES].sort((a, b) => a[2] - b[2]).slice(0, 2);
}
function nextMealHtml(compact) {
  const c = nextMealContext();
  if (!c) return '';
  const tips = mealAdvice(c);
  return `<div class="next-meal">
    <div class="small"><b>${c.meal === 'dinner' ? '🌙' : '☀️'} ${c.label}の目安</b>：あと約 <b>${r0(c.kcal)}kcal</b>・たんぱく質 ${r0(c.protein)}g・脂質 ${r0(c.fat)}g・炭水化物 ${r0(c.carbs)}g${c.share < 1 ? '<span class="muted">（夕ごはんの分を残して、残りの半分）</span>' : ''}</div>
    ${tips.map(x => `<div class="small">${x}</div>`).join('')}
    ${compact ? '' : `<div class="small" style="margin-top:6px"><b>おすすめの例</b></div>
      ${dishPicks(c).map(d => `<div class="dish"><span>${h(d[0])} <span class="tag">${d[1]}</span></span><span class="muted">${d[2]}kcal・P${d[3]} F${d[4]} C${d[5]}</span></div>`).join('')}`}
    <div class="row wrap" style="margin-top:6px">
      ${compact ? `<button class="btn sm" data-act="go" data-tab="meals">おすすめの例を見る</button>` : ''}
      <button class="btn sm" data-act="mealSuggestAI">🤖 AIに${c.label}を相談</button>
    </div>
  </div>`;
}
// いつもの朝ごはん: 今日まだ朝ごはんが無ければ1タップで記録できるボタン
function usualBreakfastBtn() {
  const u = S.settings.usualBreakfast;
  if (!u || mealsOn(ymd()).some(m => m.type === 'breakfast')) return '';
  return `<button class="btn block usual-btn" data-act="usualBreakfast">🍞 いつもの朝ごはんを記録（${h(u.name)}・${r0(u.kcal)}kcal）</button>`;
}
function mealSuggestPrompt(c, wish) {
  const ms = mealsOn(ymd()).map(m => `${MEAL_TYPES.find(x => x[0] === m.type)[1]}: ${m.name}（${r0(m.kcal)}kcal）`).join('\n') || 'まだなし';
  return `あなたは日本の管理栄養士です。利用者の${c.label}のメニューを提案してください。
【今日食べたもの】
${ms}
【${c.label}で食べてよい量の目安】約${r0(c.kcal)}kcal・たんぱく質${r0(c.protein)}g・脂質${r0(c.fat)}g・炭水化物${r0(c.carbs)}g
【なりたい体・目標】
${goalsText()}
【利用者の希望・状況】${wish || '特になし'}
- 日本で手に入りやすい料理で、外食・コンビニ・自炊がわかるように。希望や状況があればそれに合わせる
- たんぱく質をしっかりとり、脂質は目安を超えないように。余裕があれば揚げ物などを楽しんでもよいと伝える
次の形のJSONだけを返してください:
{"advice":"全体のアドバイス（1〜2文）","options":[{"name":"メニュー名","type":"外食 / コンビニ / 自炊","detail":"中身や量（例: ご飯は半膳）","kcal":数値,"protein":数値,"fat":数値,"carbs":数値,"point":"このメニューのポイント（1文）"}]}`;
}

// ===================== 食事のシート =====================
function mealSheet(m, isNew) {
  draft = structuredClone(m);
  const opt = MEAL_TYPES.map(([v, l]) => `<option value="${v}" ${v === m.type ? 'selected' : ''}>${l}</option>`).join('');
  openSheet(isNew ? '食事を記録' : '食事を編集', `
    ${m.thumb ? `<img src="${m.thumb}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px">` : ''}
    ${m.note ? `<div class="hint small">AIのメモ: ${h(m.note)}</div>` : ''}
    <div class="grid2">
      <label class="field">いつ<select id="m-type">${opt}</select></label>
      <label class="field">日付${dateBox('id="m-date"', m.date)}</label>
    </div>
    <label class="field">名前<input id="m-name" value="${h(m.name)}"></label>
    <div id="m-total" class="card" style="margin:8px 0"></div>
    <div class="spread"><b class="small">内訳（数字はタップして直せます）</b></div>
    <div class="row wrap" style="margin:6px 0">
      <span class="muted">量を調整:</span>
      ${[0.5, 0.75, 1.25, 1.5].map(f => `<button class="btn sm" data-act="mealScale" data-f="${f}">×${f}</button>`).join('')}
    </div>
    <table class="items"><tbody id="m-items"></tbody></table>
    <button class="btn sm" data-act="mealAddItem" style="margin:6px 0 12px">＋ 品目を追加</button>
    <button class="btn primary block" data-act="mealSave">保存する</button>
    <div class="${isNew ? '' : 'grid2'}" style="margin-top:8px">
      <button class="btn ${isNew ? 'block' : ''}" data-act="mealToFav">⭐ お気に入りに追加</button>
      ${isNew ? '' : '<button class="btn danger" data-act="mealDelete">削除</button>'}
    </div>
    <button class="btn block" data-act="mealUsualBreakfast" style="margin-top:8px">🍞 いつもの朝ごはんにする</button>`);
  draft._isNew = isNew;
  renderMealItems();
}
function renderMealItems() {
  $('#m-items').innerHTML = `<tr class="muted"><td class="nm">品目</td><td>kcal</td><td>P</td><td>F</td><td>C</td><td></td></tr>` +
    draft.items.map((it, i) => `<tr>
      <td class="nm"><input data-in="mealItem" data-i="${i}" data-k="name" value="${h(it.name)}">${it.amount ? `<div class="muted">${h(it.amount)}</div>` : ''}</td>
      ${['kcal', 'protein', 'fat', 'carbs'].map(k => `<td><input type="number" inputmode="decimal" data-in="mealItem" data-i="${i}" data-k="${k}" value="${r1(it[k])}"></td>`).join('')}
      <td><button class="icon-btn" data-act="mealDelItem" data-i="${i}" aria-label="削除">✕</button></td>
    </tr>`).join('');
  renderMealTotal();
}
function renderMealTotal() {
  recalcMeal(draft);
  $('#m-total').innerHTML = `<div class="grid2 small"><div>カロリー <b>${r0(draft.kcal)} kcal</b></div><div>たんぱく質 <b>${r1(draft.protein)} g</b></div>
    <div>脂質 <b>${r1(draft.fat)} g</b></div><div>炭水化物 <b>${r1(draft.carbs)} g</b></div></div>`;
}
function newMeal(fields) {
  return { id: uid(), date: mealDate, type: defaultMealType(), name: '', items: [], note: '', thumb: '', ...fields };
}

// ===================== Apple ヘルスケアから（ショートカット経由） =====================
// 1行目に BODYMAKE、続けて「種類,日付,値」（c=サイクリングkm, w=体重kg, f=体脂肪率%）
// ワークアウトは「x,日付,種類,時間,距離,kcal」
// 時間は「0:32:10」「32:10」「32分」「1920秒」などに対応して分にする
function toMinutes(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (t.includes(':')) {
    const p = t.split(':').map(Number);
    return Math.round(p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + p[1] / 60);
  }
  const n = firstNum(t);
  if (n == null) return null;
  return Math.round(/秒|sec/i.test(t) ? n / 60 : /時間|hr|hour/i.test(t) && !/分/.test(t) ? n * 60 : n);
}
// ワークアウトの種類 → 有酸素の種類（筋トレなどは取り込まない。サイクリングは c の行で取り込む）
function workoutCardioType(name) {
  const t = String(name || '');
  if (/筋力|ストレングス|strength/i.test(t) || /サイクリング|cycling/i.test(t)) return null;
  const indoor = /室内|屋内|indoor|トレッドミル/i.test(t);
  if (/ランニング|running/i.test(t)) return indoor ? 'トレッドミル（ウォーキング・ランニング）' : 'ランニング（屋外）';
  if (/ウォーキング|walking|ハイキング/i.test(t)) return indoor ? 'トレッドミル（ウォーキング・ランニング）' : 'ウォーキング（屋外）';
  if (/エリプティカル|クロストレーナー|elliptical/i.test(t)) return 'クロストレーナー';
  if (/階段|ステア|stair/i.test(t)) return 'ステアクライマー（階段）';
  if (/ローイング|rowing/i.test(t)) return 'ローイング';
  return t || 'その他';
}
function parseHealthText(text) {
  const lines = String(text || '').split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
  if (!lines.length || !/BODYMAKE/i.test(lines[0])) return null;
  const out = { c: {}, w: {}, f: {}, x: [] };
  for (const line of lines.slice(1)) {
    const [type, date, value, ...more] = line.split(/[,，、]/).map(s => s.trim());
    const m = (date || '').match(/(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/);
    if ((type || '').toLowerCase() === 'x' && m) {
      const ct = workoutCardioType(value);
      const min = toMinutes(more[0]), km = firstNum(more[1]), kcal = firstNum(more[2]);
      if (ct && (min || km)) out.x.push({ date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, type: ct, min, km: km || null, kcal: kcal ? Math.round(kcal) : null });
      continue;
    }
    let v = firstNum(value);
    const t = (type || '').toLowerCase();
    if (!m || v == null || !out[t]) continue;
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (t === 'c') out.c[d] = (out.c[d] || 0) + v;
    else {
      if (t === 'f' && v < 1) v *= 100; // 0.147 のような割合表記にも対応
      out[t][d] = v;
    }
  }
  return out;
}

async function importHealth(text) {
  const d = parseHealthText(text);
  if (!d) {
    alert('ショートカットのデータが見つかりませんでした。\n先にショートカットを実行してから、もう一度押してください。');
    return;
  }
  S.settings.healthSetup = true;
  S.settings.lastHealthImport = ymd();
  await save('settings');
  const cDates = Object.keys(d.c).filter(k => d.c[k] > 0).sort();
  const bDates = [...new Set([...Object.keys(d.w), ...Object.keys(d.f)])].sort()
    .filter(k => !S.body.some(b => b.date === k));
  if (!cDates.length && !bDates.length && !d.x.length) { alert('取り込める新しいデータはありませんでした（直近にサイクリングの記録がないか、取り込み済みです）。'); render(); return; }
  const lines = [];
  if (cDates.length) lines.push(`🚲 サイクリング ${cDates.length}日分（合計 ${r1(cDates.reduce((a, k) => a + d.c[k], 0))}km）`);
  if (bDates.length) lines.push(`⚖️ 体重・体脂肪率 ${bDates.length}日分`);
  if (d.x.length) lines.push(`🏃 ワークアウト ${d.x.length}件（${[...new Set(d.x.map(x => x.type.replace(/（.*）/, '')))].join('・')}）`);
  if (!confirm(`Apple ヘルスケアのデータを取り込みますか？\n\n${lines.join('\n')}\n\n同じ日のApple Watchの記録は新しい値で置き換えます。`)) return;
  for (const k of cDates) {
    const km = Math.round(d.c[k] * 100) / 100;
    const ride = { id: 'hk-' + k, date: k, km, min: null, bike: S.settings.bike, label: 'Apple Watch', source: 'health', created: Date.now() };
    ride.kcal = rideKcal(km, null, ride.bike);
    S.rides = S.rides.filter(r => r.id !== ride.id);
    S.rides.push(ride);
  }
  // ランニング・ウォーキングなどは、その日の「有酸素運動（Apple Watch）」の記録にまとめる（同じものは二重にしない）
  for (const x of d.x) {
    const id = 'awc-' + x.date;
    let w = S.workouts.find(y => y.id === id);
    if (!w) { w = { id, date: x.date, dayName: '有酸素運動（Apple Watch）', exercises: [], cardio: [], created: parseYmd(x.date).getTime() }; S.workouts.push(w); }
    const c = { type: x.type, min: x.min, km: x.km, kcal: x.kcal };
    const key = y => `${y.type}|${Math.round(num(y.km) * 10) || ''}|${y.min || ''}`;
    if (!w.cardio.some(y => key(y) === key(c))) w.cardio.push(c);
  }
  for (const k of bDates) {
    S.body.push({ id: 'hk-b-' + k, date: k, source: 'health', weight: d.w[k] ?? null, fatPct: d.f[k] ?? null, extra: {}, created: parseYmd(k).getTime() });
  }
  await save('rides', 'body', 'workouts');
  toast('取り込みました');
  render();
}

function healthGuideHtml() {
  return `<p class="small">iPhoneの「ショートカット」アプリで、ヘルスケアの記録をコピーするショートカットを1つ作ります（最初の1回だけ）。</p>
  <ol class="small guide">
    <li>「ショートカット」アプリを開き、右上の「＋」を押す</li>
    <li>上の名前を「<b>bodymake用にコピー</b>」に変える</li>
    <li>「アクションを検索」で <b>ヘルスケアサンプルを検索</b> を追加し、次のように設定
      <ul><li>⚠️ よく似た「ヘルスケアサンプルを<b>記録</b>」は書き込み用なので使わない（追加してしまったら✕で消す）</li><li>種類：<b>自転車の走行距離</b>（iOSによっては「サイクリングの距離」）</li><li>「開始日」が「<b>過去 7 日以内</b>」</li><li>単位：<b>km</b></li><li>グループ分け：<b>日</b></li></ul></li>
    <li><b>各項目を繰り返す</b> を追加（入力が「ヘルスケアサンプル」になっていればOK）</li>
    <li>繰り返しの中に <b>日付をフォーマット</b> を追加
      <ul><li>日付の欄をタップ →「繰り返し項目」を選び、もう一度タップして「<b>開始日</b>」を選ぶ</li><li>日付の書式：「<b>カスタム</b>」→ 文字列をフォーマットに <b>yyyy-MM-dd</b> と入力</li></ul></li>
    <li>続けて繰り返しの中に <b>テキスト</b> を追加し、次のように入れる
      <ul><li><b>c,</b> と入力 →「フォーマット済みの日付」を挿入 → <b>,</b> と入力 →「繰り返し項目」を挿入してタップし「<b>値</b>」を選ぶ</li><li>例：<code>c,フォーマット済みの日付,値</code></li></ul></li>
    <li>「繰り返しの終了」の<b>下</b>に <b>テキストを結合</b> を追加（入力：繰り返しの結果、区切り：<b>改行</b>）</li>
    <li>その下に <b>テキスト</b> を追加し、1行目に <b>BODYMAKE</b>、改行して2行目に「結合済みのテキスト」を挿入</li>
    <li>その下に <b>クリップボードにコピー</b> を追加</li>
    <li>右上の「完了」で保存</li>
  </ol>
  <h4>毎回の使い方</h4>
  <ol class="small">
    <li>ショートカット「bodymake用にコピー」をタップして実行（初回はヘルスケアへのアクセスを「許可」）</li>
    <li>bodymake を開いて「⌚ Apple Watchから取り込む」を押す</li>
  </ol>
  <p class="muted">ショートカットはホーム画面に置いたり、「オートメーション」で毎晩自動で動かしたりもできます。Apple Watchで記録した日は、ホーム画面のルートボタンを押すと二重になるので押さないでください。</p>`;
}

// ===================== 種目選び =====================
// 使い方はYouTubeの検索結果へ（リンク切れせず、マシンの見た目も動画で確認できる）
const howtoUrl = name => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`${String(name).replace(/[（()）]/g, ' ').replace(/\s+/g, ' ').trim()} やり方`);
const howtoLink = (name, text = name) => `<a class="howto" href="${howtoUrl(name)}" target="_blank" rel="noopener">${h(text)}<span class="howto-icon">▶ 使い方</span></a>`;
function effectHtml(name) {
  const c = catalogFor(name);
  return c ? `<div class="effect"><div>🎯 <b>効く場所</b>：${h(c.where)}</div><div>✨ <b>期待できる変化</b>：${h(c.effect)}</div></div>` : '';
}
function pickSheet() {
  const chosen = new Set(S.settings.chosen || DEFAULT_CHOSEN);
  draft = { pins: pinnedIds() };
  openSheet('やりたい種目を選ぶ', `
    <p class="small">やりたい種目にチェックを入れてください。「📌 毎回」を付けた種目は、ジムでも宅トレでも毎回のメニューに必ず入ります。種目名をタップすると、使い方の動画（YouTube）が開きます。<span class="tag">胸の丸み</span><span class="tag">腹筋</span>は今の目標に特に効く種目、<span class="tag">見た目の変化大</span>は体の見た目が変わりやすい種目です。</p>
    ${PARTS.map(([k, l]) => {
      const items = CATALOG.filter(c => c.part === k);
      return `<div class="pick-part"><div class="spread"><h4 style="margin:0">${l}</h4>
        <span><button class="btn sm" data-act="pickPart" data-part="${k}" data-on="1">全部選ぶ</button> <button class="btn sm" data-act="pickPart" data-part="${k}" data-on="0">全部外す</button></span></div>
        ${items.map(c => `<label class="pick ${eqOk(c) ? '' : 'disabled'}"><input type="checkbox" data-pick="${c.id}" data-part="${k}" ${chosen.has(c.id) ? 'checked' : ''} ${eqOk(c) ? '' : 'disabled'}>
          <div class="grow"><div class="spread"><div class="pick-name">${howtoLink(c.name)} ${c.goal ? `<span class="tag">${GOAL_TAGS[c.goal]}</span>` : ''}${beginnerTag(c)}${eqOk(c) ? '' : ' <span class="muted">（器具がないため選べません）</span>'}</div>
            ${eqOk(c) ? `<button class="pin ${draft.pins.has(c.id) ? 'on' : ''}" data-act="pinToggle" data-id="${c.id}">📌 毎回</button>` : ''}</div>
          <div class="small">🎯 ${h(c.where)}</div><div class="muted">✨ ${h(c.effect)}</div></div></label>`).join('')}
      </div>`;
    }).join('')}
    <button class="btn primary block" data-act="pickSave">この種目で決定</button>`);
}

// ===================== Apple Watchのスクショ読み取り =====================
function watchPrompt(count) {
  const wd = '日月火水木金土'[new Date().getDay()];
  return `これはiPhoneのフィットネスアプリ・ヘルスケアアプリ・Apple Watchのワークアウト記録の画面です（${count}枚。同じ記録が重なって写っていることがあります）。
サイクリング・ランニング・ウォーキング（屋外・室内とも）の記録を、1回のワークアウトごとに読み取ってください。それ以外の種類（筋トレなど）は読まないでください。
- 同じ記録が重なって写っている場合は1回にまとめる
- 年が無い日付は、今日（${ymd()}・${wd}曜日）以前で一番近い日付にする。「今日」「昨日」「月曜日」などの表記も日付に直す
- 読めない値は null。推測で数字を作らない
- 距離がマイルなら km に換算する。時間は分にする（例: 0:32:10 → 32）
- kcal は「アクティブカロリー」（無ければ「カロリー」）
次の形のJSONだけを返してください:
{"workouts":[{"type":"cycling か running か walking","indoor":true か false,"date":"YYYY-MM-DD","km":数値,"min":数値,"kcal":数値}],"note":"読み取りで気になった点があれば1文"}`;
}

// ===================== 自転車のカードとシート =====================
function rideCardHtml() {
  const today = ridesOn(ymd());
  const routes = S.settings.routes;
  return `<div class="card sec"><div class="sec-head"><h3>🚲 移動・有酸素</h3></div>
    ${today.length ? `<p class="small">今日 <b>${r1(today.reduce((a, r) => a + r.km, 0))}km</b>・約<b>${rideKcalOn(ymd())}kcal</b></p>
      <ul class="list">${today.map(r => `<li><div class="grow small">${h(r.label || '自転車')} ${r1(r.km)}km・約${r.kcal}kcal</div>
        <button class="icon-btn" data-act="rideDelete" data-id="${r.id}" aria-label="削除">✕</button></li>`).join('')}</ul>` : '<p class="muted">今日の記録はまだありません。</p>'}
    ${routes.length ? `<div class="row wrap" style="margin:8px 0">${routes.map((r, i) => `<button class="btn sm" data-act="rideRoute" data-i="${i}">${h(r.name)} ${r1(r.round ? r.km * 2 : r.km)}km</button>`).join('')}</div>` : ''}
    <button class="btn block" data-act="rideNew">＋ 距離を入れて記録</button>
    ${S.settings.healthSetup ? '<button class="btn block" data-act="runShortcut" style="margin-top:8px">🔄 Apple Watchの記録を更新（ショートカット）</button>' : ''}
    <button class="btn block" data-act="healthImport" style="margin-top:8px">⌚ Apple Watchから取り込む</button>
    <p class="muted">${rideWeekText()}</p>
  </div>`;
}
function rideSheet() {
  openSheet('自転車の移動を記録', `
    <label class="field">日付${dateBox('id="r-date"', ymd())}</label>
    <div class="grid2">
      <label class="field">距離（km・片道）<input type="number" inputmode="decimal" id="r-km" data-in="ride" placeholder="例: 5"></label>
      <label class="field">時間（分・任意）<input type="number" inputmode="numeric" id="r-min" data-in="ride" placeholder="空欄でOK"></label>
    </div>
    <label class="check"><input type="checkbox" id="r-round" data-in="ride">往復（距離と時間を2倍にする）</label>
    <label class="field">自転車<select id="r-bike" data-in="ride">${BIKES.map(([v, l]) => `<option value="${v}" ${v === S.settings.bike ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="hint small" id="r-preview">距離を入れると消費カロリーを計算します</div>
    <label class="field">名前（任意。例: 自宅→ジム）<input id="r-name" placeholder="自宅→ジム"></label>
    <label class="check"><input type="checkbox" id="r-keep">よく使うルートとして保存（次からホーム画面のボタン1つで記録）</label>
    <p class="muted">距離はGoogleマップなどの「自転車」ルートで確認できます。時間が空欄のときは時速15km（ロードバイクは22km）として計算します。</p>
    <button class="btn primary block" data-act="rideSave">記録する</button>`);
}

// ===================== みんなで食べた（会食・分け合い） =====================
const SHARE_AMOUNTS = [[0.7, '少なめ'], [1, '同じくらい'], [1.3, '多め']];
// 自分の飲み物 1杯あたり [名前, kcal, たんぱく質, 脂質, 炭水化物]（お酒のカロリーはPFC以外にアルコール分を含む）
const DRINKS = [
  ['beer', 'ビール 中ジョッキ', 180, 1.5, 0, 14],
  ['beerS', 'ビール グラス・小', 100, 0.8, 0, 8],
  ['high', 'ハイボール', 80, 0, 0, 0],
  ['sour', 'レモンサワー・チューハイ', 150, 0, 0, 15],
  ['sake', '日本酒 1合', 190, 0.7, 0, 8],
  ['wine', 'ワイン グラス', 90, 0.2, 0, 2],
  ['shochu', '焼酎（水割り・お湯割り）', 70, 0, 0, 0],
  ['cocktail', 'カクテル・梅酒', 180, 0, 0, 20],
  ['juice', 'ジュース・ソフトドリンク', 140, 0, 0, 35],
  ['tea', 'ウーロン茶・お茶', 0, 0, 0, 0],
];
// ざっくり記録: 1人前（ふつう）の目安 [名前, kcal, たんぱく質%, 脂質%, 炭水化物%]
const SHOPS = [
  ['izakaya', '居酒屋', 900, 20, 40, 40], ['yakiniku', '焼肉', 1100, 25, 50, 25], ['chuka', '中華', 1000, 15, 40, 45],
  ['italian', 'イタリアン', 1000, 15, 35, 50], ['sushi', '寿司', 800, 20, 15, 65], ['nabe', '鍋', 800, 30, 30, 40],
  ['famires', 'ファミレス', 900, 15, 40, 45], ['cafe', 'カフェ・軽食', 500, 10, 40, 50], ['other', 'その他', 900, 18, 35, 47],
];
const ROUGH_AMOUNTS = [[0.7, '少なめ'], [1, 'ふつう'], [1.4, 'たくさん']];

function shareSheet() {
  draft = { mode: 'photo', people: 4, factor: 1, drinks: {}, shop: 'izakaya', rough: 1 };
  openSheet('みんなで食べた食事を記録', '<div id="share-body"></div>');
  renderShare();
}
function renderShare() {
  const d = draft;
  const seg = (act, list, cur) => `<div class="seg">${list.map(([v, l]) => `<button class="${String(v) === String(cur) ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const drinkKcal = DRINKS.reduce((a, x) => a + (d.drinks[x[0]] || 0) * x[2], 0);
  $('#share-body').innerHTML = `
    <p class="small">記録のしかた</p>
    ${seg('shareMode', [['photo', '📷 写真'], ['receipt', '🧾 レシート'], ['rough', '⚡ ざっくり']], d.mode)}
    <p class="muted">${{ photo: '料理が並んだテーブル全体を1〜2枚撮った写真から計算します。', receipt: '会計のレシート（伝票）の写真から、頼んだ料理を読み取って計算します。', rough: 'お店の種類と量から、だいたいのカロリーを入れます（写真なし・AIなし）。' }[d.mode]}</p>
    ${d.mode === 'rough' ? `
      <label class="field">お店の種類<select data-in="shareShop">${SHOPS.map(x => `<option value="${x[0]}" ${x[0] === d.shop ? 'selected' : ''}>${x[1]}</option>`).join('')}</select></label>
      <p class="small">自分が食べた量</p>${seg('shareRough', ROUGH_AMOUNTS, d.rough)}`
    : `
      <div class="spread" style="margin-top:12px"><span class="small">何人で分けた？</span>
        <span class="stepper"><button class="btn sm" data-act="sharePeople" data-v="-1">−</button><b>${d.people}人</b><button class="btn sm" data-act="sharePeople" data-v="1">＋</button></span></div>
      <p class="small">自分が食べた量（みんなと比べて）</p>${seg('shareFactor', SHARE_AMOUNTS, d.factor)}`}
    <h4>🍺 自分の飲み物</h4>
    <p class="muted">飲み物は人によって量が違うので、自分の分だけ数えます。${drinkKcal ? `今 <b>${drinkKcal}kcal</b>` : ''}</p>
    ${DRINKS.map(x => `<div class="drink-row"><span class="small">${x[1]} <span class="muted">${x[2]}kcal</span></span>
      <span class="stepper"><button class="btn sm" data-act="shareDrink" data-k="${x[0]}" data-v="-1">−</button><b>${d.drinks[x[0]] || 0}</b><button class="btn sm" data-act="shareDrink" data-k="${x[0]}" data-v="1">＋</button></span></div>`).join('')}
    <button class="btn primary block" data-act="shareRun" style="margin-top:14px">${{ photo: '📷 写真を選んで計算', receipt: '🧾 レシートを選んで計算', rough: '計算する' }[d.mode]}</button>`;
}
function sharePrompt(kind, people) {
  return `あなたは日本の管理栄養士です。これは${people}人で分け合って食べた食事の${kind === 'receipt' ? 'レシート（伝票）' : 'テーブルの写真'}です。
${kind === 'receipt' ? 'レシートに書かれた料理名と数量を読み取り、' : '写っている料理をすべて特定し、'}テーブル全体（${people}人分の合計）の料理ごとのカロリー(kcal)・たんぱく質(g)・脂質(g)・炭水化物(g)を見積もってください。
- 飲み物（お酒・ソフトドリンク）は含めない（別に数えます）
${kind === 'receipt' ? '- 数量が2以上なら、その分を合計した値にする。席料・サービス料・割引など食べ物でないものは除く。お通しは含める' : '- 写っている量で見積もる。取り皿に取り分けた料理も含める'}
- 日本の一般的な外食の1皿の量を参考にする
次の形のJSONだけを返してください（数値は数字のみ）:
{"name":"食事の短い名前（例: 焼肉）","items":[{"name":"料理名","amount":"全体の量（例: 2皿）","kcal":数値,"protein":数値,"fat":数値,"carbs":数値}],"note":"推定の根拠や注意点を1〜2文"}`;
}
function drinkItems() {
  return DRINKS.filter(x => draft.drinks[x[0]]).map(x => {
    const n = draft.drinks[x[0]];
    return { name: x[1], amount: `${n}杯（自分の分）`, kcal: x[2] * n, protein: x[3] * n, fat: x[4] * n, carbs: x[5] * n };
  });
}

// ===================== 体データのシート =====================
function bodySheet(b, isNew) {
  draft = structuredClone(b);
  draft._isNew = isNew;
  const shown = BODY_FIELDS.filter(([k]) => b.source !== 'tanita' || !['skeletalMuscle', 'score'].includes(k));
  openSheet(isNew ? '測定結果を記録' : '測定結果を編集', `
    ${b.note ? `<div class="hint small">AIのメモ: ${h(b.note)}</div>` : ''}
    <div class="grid2">
      <label class="field">日付${dateBox('id="b-date"', b.date)}</label>
      <label class="field">測った機械<select id="b-source">${Object.entries(SOURCES).map(([v, l]) => `<option value="${v}" ${v === b.source ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="grid2">${shown.map(([k, l, u]) => `<label class="field">${l}${u ? `（${u}）` : ''}<input type="number" inputmode="decimal" id="b-${k}" value="${b[k] ?? ''}"></label>`).join('')}</div>
    ${b.extra && Object.keys(b.extra).length ? `<p class="muted">その他の読み取り値: ${h(Object.entries(b.extra).map(([k, v]) => `${k} ${v}`).join('、'))}</p>` : ''}
    <button class="btn primary block" data-act="bodySave">保存する</button>
    ${isNew ? '' : '<button class="btn danger block" data-act="bodyDelete" style="margin-top:8px">削除</button>'}`);
}

function bodyReadPrompt(src, count) {
  const what = src === 'inbody' ? 'InBody（インボディ）の測定結果（スマホアプリの画面のスクリーンショット、または結果用紙）' : '家庭用の体重計・体組成計（タニタ・オムロンなど）の表示画面（または記録アプリの画面）';
  const multi = count > 1 ? `画像は${count}枚あり、同じ結果画面をスクロールしながら撮ったもの（画面収録から切り出したコマを含む）です。重なっている部分は同じ値なので、すべての画像を見て各項目を1回ずつまとめてください。\n` : '';
  return `これは${what}の画像です。${multi}写っている数値を正確に読み取ってください。読み取れない項目は null にしてください。推測で数字を作らないでください。部位別（右腕・左腕・体幹・右脚・左脚）の筋肉量や体脂肪量、評価（標準・標準以上など）が写っていれば extra に入れてください。
次の形のJSONだけを返してください:
{"date":"測定日 YYYY-MM-DD（写っていなければ null）","weight":体重kg,"fatPct":体脂肪率%,"skeletalMuscle":骨格筋量kg,"muscle":筋肉量kg,"fatMass":体脂肪量kg,"bmr":基礎代謝kcal,"visceral":内臓脂肪レベル,"water":体水分量kg,"score":InBody点数,"extra":{"その他読み取れた項目名（部位別筋肉量、推定骨量、体内年齢、BMIなど）":"値と単位"},"note":"読み取りで気になった点があれば1文"}`;
}

// ===================== InBodyアプリのCSV取り込み =====================
// 列名（単位の手前まで）→ アプリの項目
const INBODY_COLS = {
  '体重': 'weight', '骨格筋量': 'skeletalMuscle', '筋肉量': 'muscle', '体脂肪量': 'fatMass', '体脂肪率': 'fatPct',
  '基礎代謝量': 'bmr', 'InBody点数': 'score', '内臓脂肪レベル': 'visceral', '体水分量': 'water',
};
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function parseInbodyCsv(text) {
  const [head, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  const names = head.map(x => x.trim());
  const dateCol = names.indexOf('日付');
  if (dateCol < 0 || !names.some(n => n.startsWith('体重'))) return null;
  return rows.map(r => {
    const stamp = (r[dateCol] || '').trim();
    const m = stamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/);
    if (!m) return null;
    const b = { id: 'inbody-' + stamp, source: 'inbody', date: `${m[1]}-${m[2]}-${m[3]}`, extra: {},
      created: new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() };
    names.forEach((n, i) => {
      const v = (r[i] || '').trim();
      if (i === dateCol || n === '測定機器' || !v || v === '-') return;
      const key = INBODY_COLS[n.replace(/\s*\(.*$/, '')];
      if (key) b[key] = num(v); else b.extra[n] = v;
    });
    return b.weight != null ? b : null;
  }).filter(Boolean);
}

// ===================== 体の写真分析 =====================
const SLOTS = [['front', '正面'], ['side', '横'], ['back', '後ろ']];
function analyzeSheet() {
  draft = { photos: {} };
  openSheet('体の写真で分析', `
    <p class="small">正面・横・後ろの写真を用意してください（正面だけでもOK）。</p>
    <ul class="plain small"><li>力を抜いた自然な姿勢で、全身〜太ももくらいまで</li><li>明るい場所で、毎回同じ場所・同じ時間帯に</li><li>顔は写さなくて大丈夫です</li></ul>
    <div class="slots">${SLOTS.map(([k, l]) => `<button class="slot" data-act="slotPick" data-k="${k}" id="slot-${k}">＋<br>${l}</button>`).join('')}</div>
    <div class="notice">写真はGoogleのAIに送られます（無料枠ではAIの改善に使われることがあります）。アプリ内には小さな写真だけ保存されます。</div>
    <button class="btn primary block" data-act="analyzeRun">分析する</button>`);
}
function analyzePrompt(labels) {
  return `あなたは経験豊富なパーソナルトレーナーです。添付は利用者の体の写真です（順に: ${labels.join('、')}）。
医学的な診断ではなく、トレーニングの方向性を決める参考として、見た目から筋肉の発達具合と体脂肪の付き方を分析してください。正直に、でも前向きな言葉で。
【利用者の情報】
${profileText()}
【なりたい体・目標】
${goalsText()}
【使える器具】${equipmentText()}
【トレーニング頻度】週${S.settings.daysPerWeek}回
【前回の分析】
${latestAnalysisText()}
次の形のJSONだけを返してください:
{"overall":"全体の印象（2〜3文。前回の分析があれば変化にも触れる）","bodyFatEstimate":"見た目からの体脂肪率の目安（例: 15〜18%）","strengths":["よく発達している部位"],"weakPoints":[{"part":"部位","detail":"目標に対してどう足りないか","priority":1}],"trainingFocus":["目標に近づくために重点的にやること（具体的な種目名を含める）"],"nutritionAdvice":"食事についての助言（1〜3文）","nextCheck":"次に写真を撮るときのアドバイス"}
priority は 1（最優先）〜3 の数字です。`;
}
function analysisHtml(a) {
  const r = a.result;
  return `${a.photos?.length ? `<div class="photos-row">${a.photos.map(p => `<img src="${p}" alt="">`).join('')}</div>` : ''}
    <p>${h(r.overall)}</p>
    ${r.bodyFatEstimate ? `<p class="small">見た目の体脂肪率の目安: <b>${h(r.bodyFatEstimate)}</b></p>` : ''}
    ${r.strengths?.length ? `<h4>よく発達している部位</h4><ul class="plain small">${r.strengths.map(s => `<li>${h(s)}</li>`).join('')}</ul>` : ''}
    ${r.weakPoints?.length ? `<h4>伸ばしたい部位</h4><ul class="plain small">${[...r.weakPoints].sort((x, y) => (x.priority || 3) - (y.priority || 3)).map(w => `<li><b>${h(w.part)}</b>${w.priority === 1 ? ' <span class="tag">最優先</span>' : ''}：${h(w.detail)}</li>`).join('')}</ul>` : ''}
    ${r.trainingFocus?.length ? `<h4>重点的にやること</h4><ul class="plain small">${r.trainingFocus.map(s => `<li>${h(s)}</li>`).join('')}</ul>` : ''}
    ${r.nutritionAdvice ? `<h4>食事</h4><p class="small">${h(r.nutritionAdvice)}</p>` : ''}
    ${r.nextCheck ? `<p class="muted">次回の撮影: ${h(r.nextCheck)}</p>` : ''}`;
}

// ===================== メニュー作成（AI） =====================
function lastTrainedText() {
  const map = lastTrainedMap();
  const list = PARTS.filter(([k]) => map[k]).map(([k, l]) => `${l}: ${map[k]}`);
  return list.length ? `今日は${ymd()}。部位ごとの最後に鍛えた日 → ${list.join('、')}` : 'まだ記録はありません。';
}
function planPrompt() {
  const st = S.settings;
  return `あなたは経験豊富なパーソナルトレーナーです。次の利用者のために、週${st.daysPerWeek}回のジムのトレーニングメニュー（${st.daysPerWeek}日分のローテーション）を作ってください。
【1回にかけられる時間（厳守）】${sessionText()}
- ジムでは器具の空き待ちや重さの付け替えがあるので、余裕のあるメニューにしてください。見積もりは「ウォームアップ10分＋1種目（3セット）約12分＋腹筋1種目約5分」とし、合計が時間より5〜10分短くなるようにしてください（例: 60分なら3種目＋腹筋1種目）。estMin にその日の合計の目安（分）を入れてください。
- 各種目の alt には、その器具が混んでいて使えないときの代わりの種目（同じ部位・別の器具。【やりたい種目】以外でも可）を書いてください。
- ${st.sessionMode === 'weights' ? '有酸素運動はジムでは行いません（ふだんの自転車移動で行っています）。cardio は null にしてください。' : st.sessionMode === 'both' ? `各日に有酸素運動（${num(st.cardioMin) || 20}分）を cardio に入れてください。種類・強さ・タイミング（筋トレの前か後か）を目標に合わせて決めてください。` : `有酸素運動だけのメニューにしてください（exercises は空、cardio に${num(st.cardioMin) || 20}分の内容）。`}
アマチュアでも安全にできる種目を中心に、目標に直結する種目を優先し、腹筋の目標がある場合は毎回お腹の種目を入れてください。種目名は日本のジムで一般的な呼び方にしてください。
【種目の順番（重要）】
- ベンチプレスなど重さを扱う多関節種目（フリーウェイト・スミスマシン）を最初に、次にマシンの多関節種目、その後にマシン・ケーブル・ダンベルの単関節種目（フライ・レイズ・カール等）、腹筋は最後にしてください。
【重さの提案（重要）】
- すべての種目に、今日使う重さの目安（weight）を必ず書いてください。
- 記録がある種目は「種目ごとの実力」の最近の重さ×回数と推定最大重量から、指定の回数をフォームを崩さずできる重さにしてください（目標の回数ぎりぎりで2回ほど余力が残る程度）。
- 記録が無い種目は、近い種目の記録から推定し「◯kg前後（初回は軽めで確認）」のように書いてください。自重種目は「自重」と書いてください。
- 種目は【やりたい種目】の中からだけ選び、名前もそのまま使ってください。記録の中で呼び方が違う同じ種目があれば、その重さを参考にしてください。
- progression には「何回できたら何kg上げるか」を書いてください。
【利用者の情報】
${profileText()}
【なりたい体・目標】
${goalsText()}
【使える器具】${equipmentText()}
【やりたい種目（この中からだけ選ぶ）】
${chosenList().map(c => `- ${c.name}（${c.where}）`).join('\n')}
【やらない部位】${PARTS.filter(([k]) => !chosenList().some(c => c.part === k)).map(([, l]) => l).join('、') || 'なし'}
【毎回必ず入れる種目】${pinnedList().map(c => c.name).join('、') || 'なし'}
【ふだんの自転車移動】${rideWeekText()}
【体の写真の分析】
${latestAnalysisText()}
【種目ごとの実力（重さの単位はkg）】
${strengthText()}
【最近のトレーニング記録】
${recentWorkoutsText()}
【メニューの並べ方（超回復）】
- days の1日目は、次に行ったときに最初にやるメニューです。${lastTrainedText()}
- 1日目には、まだ回復していない部位（大きい筋肉は72時間、小さい筋肉は48時間以内に鍛えた部位）を入れず、休めている部位のメニューにしてください。2日目以降も、続けて同じ部位を鍛えない順番にしてください。
次の形のJSONだけを返してください:
{"days":[{"name":"A 胸・肩・腹 のような短い名前","focus":"この日の狙い（1文）","estMin":60,"cardio":{"type":"エアロバイク など","min":20,"note":"強さやタイミング"},"exercises":[{"name":"種目名","sets":3,"reps":"8-12","rest":"90秒","weight":"今日の重さの目安（例: 40kg）","progression":"重さを上げる条件（例: 3セットとも12回できたら42.5kg）","alt":"混んでいたときの代わりの種目","note":"フォームのコツを短く"}]}],"tips":["全体のアドバイス（2〜4個）"]}`;
}

function kmemoPrompt(count) {
  return `これはiPhoneの筋トレ記録アプリ「筋トレメモ」の画面の画像です（${count}枚。スクロールしながら撮ったもので、同じ内容が重なって写っていることがあります）。
写っているトレーニング記録を、日付ごとにまとめて読み取ってください。
- 重なって写っている同じ記録は1回にまとめる
- 読めない値は null。推測で数字を作らない
- 年が書かれていない日付は、今日（${ymd()}）以前で一番近い日付として解釈する。日付がまったく分からない場合は null
- 重さの単位が lb の場合は kg に換算する。自重の種目は w を 0 にする
- 1セットごとに重さ(w)と回数(r)を分けて入れる（「40kg × 10回 × 3セット」なら同じセットを3つ）
- 種目名は画面の表記のまま
次の形のJSONだけを返してください:
{"sessions":[{"date":"YYYY-MM-DD または null","exercises":[{"name":"種目名","sets":[{"w":40,"r":10}]}]}],"note":"読み取りで気になった点があれば1文"}`;
}

// ===================== トレーニング記録のシート =====================
function resumeDraft(exName) {
  workoutSheet(todayDraft(), false);
  scrollToEx(exName);
  toast('途中の記録の続きから始めます');
}
function scrollToEx(name) {
  const i = name ? draft?.exercises.findIndex(e => e.name === name) : -1;
  if (i >= 0) $$('#w-list > .ex')[i]?.scrollIntoView({ block: 'start' });
}
function workoutSheet(w, isNew) {
  draft = structuredClone(w);
  // 途中保存した記録は、まだやっていないセットも含めて元に戻す
  if (draft.full) draft.exercises = draft.full;
  delete draft.full;
  draft._isNew = isNew;
  draft._open = isNew || inProgress(w);
  draft.unit ||= S.settings.unit;
  draft.cardio ||= [];
  const days = currentPlan().days;
  const dayIdx = days.findIndex(d => d.name === w.dayName);
  openSheet(isNew ? 'トレーニングを記録' : '記録を編集', `
    <label class="field">日付${dateBox('id="w-date"', w.date)}</label>
    ${isNew ? `<label class="field">メニュー<select data-in="workoutDay">${days.map((d, i) => `<option value="${i}" ${i === dayIdx ? 'selected' : ''}>メニュー${'ABCDEFG'[i]} ${h(dayTitle(d))}</option>`).join('')}
      <option value="-1" ${dayIdx < 0 ? 'selected' : ''}>有酸素運動だけ</option></select></label>` : `<p class="small"><b>${h(w.dayName)}</b></p>`}
    <div class="spread" style="margin:6px 0"><span class="small">重さの単位</span>
      <div class="seg" id="w-unit">${['kg', 'lb'].map(u => `<button class="${draft.unit === u ? 'on' : ''}" data-act="workoutUnit" data-u="${u}">${u}</button>`).join('')}</div></div>
    <button class="btn block" data-act="workoutImage" style="margin:4px 0 8px">📷 筋トレメモの画面から入力</button>
    <div id="w-list"></div>
    <label class="field" style="margin:8px 0 4px">＋ 種目を追加<select id="w-pick" data-in="workoutPick">
      <option value="">部位から選ぶ…</option>
      ${PARTS.map(([k, l]) => `<optgroup label="${l}">${CATALOG.filter(c => c.part === k && eqOk(c)).map(c => `<option value="${h(c.name)}">${h(c.name)}</option>`).join('')}</optgroup>`).join('')}
      <optgroup label="自重（宅トレ）">${HOME_CATALOG.map(c => `<option value="${h(c.name)}">${h(c.name)}</option>`).join('')}</optgroup>
      <option value="__other">✏️ リストに無い種目を書く</option></select></label>
    <div class="row" id="w-other" style="margin:0 0 16px" hidden><input id="w-newex" placeholder="種目名（例: ディップス）"><button class="btn sm" data-act="workoutAddEx">追加</button></div>
    <div class="cardio-box"><h4 style="margin-top:0">🏃 有酸素運動</h4><div id="w-cardio"></div>
      <button class="btn sm" data-act="cardioAdd">＋ 有酸素運動を追加</button></div>
    ${isNew ? '' : '<button class="btn danger block" data-act="workoutDelete" style="margin-top:14px">削除</button>'}
    <div class="sheet-foot">${draft._open
      ? '<button class="btn" data-act="workoutSaveMid">💾 途中保存</button><button class="btn primary" data-act="workoutSave">✅ 保存して終わる</button>'
      : '<button class="btn primary" data-act="workoutSave" style="grid-column:1/-1">保存する</button>'}</div>`,
    inProgress(w) ? '閉じる（途中保存した分は残ります）' : null);
  renderWorkoutList();
  renderCardio();
}
function renderCardio() {
  $('#w-cardio').innerHTML = draft.cardio.map((c, ci) => `<div class="cardio-row">
    <div class="spread"><select data-in="cardio" data-c="${ci}" data-k="type">${[...new Set([...CARDIO_TYPES, c.type].filter(Boolean))].map(t => `<option ${t === c.type ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>
      <button class="icon-btn" data-act="cardioDel" data-c="${ci}" aria-label="削除">✕</button></div>
    <div class="grid3">
      <label class="field">時間（分）<input type="number" inputmode="numeric" data-in="cardio" data-c="${ci}" data-k="min" value="${c.min ?? ''}"></label>
      <label class="field">距離 km<input type="number" inputmode="decimal" data-in="cardio" data-c="${ci}" data-k="km" value="${c.km ?? ''}" placeholder="任意"></label>
      <label class="field">消費 kcal<input type="number" inputmode="numeric" data-in="cardio" data-c="${ci}" data-k="kcal" value="${c.kcal ?? ''}" placeholder="任意"></label>
    </div></div>`).join('');
}
const weightLbNote = (w, u = S.settings.unit) => (u === 'lb' && /kg/i.test(w) && firstNum(w) ? `（約${toUnit(firstNum(w), 'lb')}lb）` : '');
function workoutFromPlanDay(day, date = ymd()) {
  return {
    id: uid(), date, dayName: day.name, unit: S.settings.unit, ...(day.home ? { place: 'home' } : {}),
    cardio: day.cardio ? [{ type: day.cardio.type, min: day.cardio.min }] : [],
    exercises: day.exercises.map(e => {
      const last = lastPerf(e.name);
      const n = num(e.sets) || 3;
      // 今日の調整で重さを変えたときは、その重さを入れる
      const guess = !day.home && !last && !firstNum(e.weight) ? estimateWeight(e.name, e.reps) : null;
      const sets = Array.from({ length: n }, (_, i) => ({ w: day.home ? 0 : e.adj && firstNum(e.weight) ? firstNum(e.weight) : last ? (last.sets[i] || last.sets.at(-1)).w : firstNum(e.weight) ?? guess, r: null }));
      return { name: e.name, reps: e.reps, weight: e.weight || '', target: `${n}×${e.reps}`, alt: altOf(e, day.exercises.map(x => x.name)) || '', sets, ...(guess ? { guess } : {}) };
    }),
  };
}
// 記録に種目を足す。前回の記録 → 無ければおすすめの重さを入れておく
function addExercise(name) {
  const last = lastPerf(name), c = catalogFor(name);
  const guess = !last && c ? estimateWeight(name, c.reps) : null;
  const n = num(c?.sets) || 3;
  draft.exercises.push({
    name, reps: c?.reps || '', target: c ? `${n}×${c.reps}` : '', ...(guess ? { guess } : {}),
    sets: last ? last.sets.map(s => ({ w: s.w, r: null })) : Array.from({ length: c ? n : 1 }, () => ({ w: c?.eq === 'body' || !c?.eq ? (c ? 0 : null) : guess, r: null })),
  });
  renderWorkoutList();
  $$('#w-list > .ex').at(-1)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast(`「${name}」を追加しました`);
}
// 記録を保存する。final=false は途中保存（まだのセットを full に残す）
async function storeWorkout(final) {
  const w = { ...draft, date: $('#w-date').value || ymd() };
  for (const k of ['_isNew', '_open']) delete w[k];
  const done = e => { const x = { ...e, sets: e.sets.filter(s => num(s.r) != null) }; delete x._saved; return x; };
  w.exercises = w.exercises.map(done).filter(e => e.sets.length);
  w.cardio = (w.cardio || []).filter(c => num(c.min) > 0);
  if (!w.exercises.length && !w.cardio.length) { alert('記録する内容がありません。筋トレは「回数」、有酸素運動は「時間」を入れてから保存してください。'); return null; }
  if (!final && w.date === ymd()) w.full = structuredClone(draft.exercises);
  if (draft._isNew) { w.created = Date.now(); S.workouts.push(w); draft._isNew = false; }
  else S.workouts = S.workouts.map(x => (x.id === w.id ? w : x));
  await save('workouts');
  return w;
}
function renderWorkoutList() {
  const u = draft.unit;
  $('#w-list').innerHTML = draft.exercises.map((e, ei) => {
    const last = lastPerf(e.name, draft.id);
    const hint = overloadHint(e, last, u);
    const filled = e.sets.length && e.sets.every(s => num(s.r) != null);
    return `<div class="ex ${e._saved ? 'saved' : ''}">
      <div class="spread"><div class="ex-name">${e._saved ? '✅ ' : ''}${howtoLink(e.name)}</div><button class="icon-btn" data-act="workoutDelEx" data-e="${ei}" aria-label="種目を削除">✕</button></div>
      ${e.alt ? `<button class="btn sm alt-btn" data-act="workoutSwap" data-e="${ei}">🔁 ${draft.place === 'home' ? 'きつければ' : '混んでいたら'}「${h(e.alt)}」に変える</button>` : ''}
      <div class="small">${e.target ? `<span class="tag">目標 ${h(e.target)}${e.weight ? ` ・ ${h(e.weight)}${weightLbNote(e.weight, u)}` : ''}</span>` : ''}<span class="muted">${last ? `前回 ${jpDate(last.date)}: ${h(setsText(last.sets, u))}` : '前回の記録なし'}</span></div>
      ${hint ? `<div class="hint small">${h(hint)}</div>` : ''}
      ${!last && e.guess ? `<div class="hint small">🔰 初めての種目です。今の実力から <b>${toUnit(e.guess, u)}${u}</b> をおすすめします（${benchLevel().from === 'record' ? 'ほかの種目の記録から推定' : '体重から推定'}）。1セット目で重さを確かめて、きつければ軽くしてください。マシンは機種で重さの感じ方が変わります。</div>` : ''}
      <table class="sets"><tr><th>セット</th><th>重さ ${u}</th><th>回数${e.reps && !/秒/.test(e.reps) ? `<span class="muted">（目標 ${h(e.reps)}）</span>` : ''}</th><th></th></tr>
        ${e.sets.map((s, si) => `<tr><td>${si + 1}</td>
          <td><input type="text" inputmode="decimal" class="set-in" data-in="wset" data-e="${ei}" data-s="${si}" data-k="w" value="${toUnit(num(s.w), u) ?? ''}" placeholder=" "></td>
          <td><input type="text" inputmode="numeric" class="set-in" data-in="wset" data-e="${ei}" data-s="${si}" data-k="r" value="${s.r ?? ''}" placeholder=" "></td>
          <td><button class="icon-btn" data-act="workoutDelSet" data-e="${ei}" data-s="${si}" aria-label="セットを削除">−</button></td></tr>`).join('')}
      </table>
      <div class="ex-foot"><button class="btn sm" data-act="workoutAddSet" data-e="${ei}">＋ セット</button>
        ${draft._open ? `<button class="btn sm ${filled && !e._saved ? 'primary' : ''}" data-act="workoutSaveEx" data-e="${ei}">${e._saved ? '✅ 保存済み（直したら押す）' : '💾 この種目を保存'}</button>` : ''}</div>
    </div>`;
  }).join('');
}

// ===================== ボタンの動き =====================
const ACT = {
  go: el => { tab = el.dataset.tab; if (tab === 'meals') mealDate = ymd(); render(); },
  closeSheet,
  aiCancel: () => aiCtrl?.abort(),

  // ---- 食事 ----
  mealDay: el => { mealDate = addDays(mealDate, +el.dataset.d); render(); },
  async mealPhoto() {
    const [file] = await pickPhotos();
    if (!file) return;
    const img = await fileToJpeg(file, 1280);
    const thumb = await resizeImage(img, 360, 0.7);
    const hint = prompt('補足があれば入力（例: ご飯は半分残した / コンビニのサラダチキン）。無ければそのままOK', '') ?? '';
    const r = await runAI('AIが食事を分析中…', sig => gemini(mealPhotoPrompt(hint), [img], sig), 'meal');
    if (!r) return;
    const m = normalizeMeal(r);
    learnFoods(m.items);
    mealSheet(newMeal({ ...m, thumb }), true);
  },
  mealText: () => foodSheet(),
  foodPick(el) {
    const f = draft.res[+el.dataset.i];
    // お気に入りは中身（品目）ごと記録へ
    if (f.kind === 'fav') { mealSheet(newMeal({ name: f.name, items: structuredClone(f.items) }), true); return; }
    draft.sel.push({ ...f, q: foodQty(f) });
    $('#fs-q').value = '';
    draft.res = [];
    renderFoodRes();
    renderFoodSel();
    toast(`「${f.name}」を追加しました`);
  },
  foodQty(el) { draft.sel[+el.dataset.i].q = +el.dataset.v; renderFoodSel(); },
  foodDel(el) { draft.sel.splice(+el.dataset.i, 1); renderFoodSel(); },
  foodDone() {
    const items = draft.sel.map(foodItem);
    mealSheet(newMeal({ name: items.map(i => i.name.replace(/（.*?）/g, '')).join('・'), items }), true);
  },
  async foodAI() {
    const q = $('#fs-q').value.trim();
    const text = prompt('食べたものを入力してください（AIが計算します）\n（例: 牛丼並盛と味噌汁、ゆで卵1個）', q);
    if (!text?.trim()) return;
    const keep = draft.sel.map(foodItem);
    const r = await runAI('AIが計算中…', sig => gemini(mealTextPrompt(text), [], sig), 'text');
    if (!r) return;
    const m = normalizeMeal(r);
    await learnFoods(m.items);
    mealSheet(newMeal({ ...m, items: [...keep, ...m.items], name: [...keep.map(i => i.name), m.name].join('・') }), true);
    toast('次からは、この料理もすぐ探せます');
  },
  eventNew: () => eventSheet(),
  async eventSave() {
    const date = $('#ev-date').value;
    if (!date) { alert('日付を選んでください'); return; }
    const shop = SHOPS.find(x => x[0] === $('#ev-shop').value)[1];
    S.events = [...(S.events || []), { id: uid(), date, label: $('#ev-label').value.trim() || `${shop}（お酒${$('#ev-drinks').value}杯）`, kcal: eventKcalCalc() }];
    await save('events');
    closeSheet();
    render();
    toast('予定を入れました。前後の日の目標カロリーを調整します');
  },
  async eventDelete(el) {
    if (!confirm('この予定を削除しますか？')) return;
    S.events = S.events.filter(e => e.id !== el.dataset.id);
    await save('events');
    render();
  },
  async foodAnalyzeAI() {
    const r = await runAI('AIが食事のバランスを分析中…', sig => gemini(foodAnalyzePrompt(), [], sig), 'plan');
    if (!r) return;
    openSheet('1週間・1か月の食事の分析', `
      ${r.summary ? `<div class="hint small">💬 ${h(r.summary)}</div>` : ''}
      ${r.patterns?.length ? `<h4>見つかった傾向</h4><ul class="plain small">${r.patterns.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
      ${r.advice?.length ? `<h4>アドバイス</h4><ul class="plain small">${r.advice.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
      ${r.nextWeek ? `<h4>これからの1週間</h4><p class="small">${h(r.nextWeek)}</p>` : ''}`);
  },
  async mealUsualBreakfast() {
    recalcMeal(draft);
    const name = $('#m-name').value.trim() || draft.items.map(i => i.name).join('・') || '朝ごはん';
    S.settings.usualBreakfast = { name, items: structuredClone(draft.items), kcal: draft.kcal, protein: draft.protein, fat: draft.fat, carbs: draft.carbs };
    await save('settings');
    toast('いつもの朝ごはんに登録しました。次からホーム画面のボタン1つで記録できます');
  },
  async usualBreakfast() {
    const u = S.settings.usualBreakfast;
    const m = recalcMeal(newMeal({ date: ymd(), type: 'breakfast', name: u.name, items: structuredClone(u.items), created: Date.now() }));
    S.meals.push(m);
    await save('meals');
    toast(`いつもの朝ごはん（${r0(m.kcal)}kcal）を記録しました`);
    render();
  },
  async mealSuggestAI() {
    const c = nextMealContext();
    if (!c) return;
    const wish = prompt(`${c.label}の希望や状況があれば書いてください（なければ空のままOK）\n例：外食で焼肉の予定／冷蔵庫に豚肉とキャベツ／さっぱりしたい`, '');
    if (wish === null) return;
    const r = await runAI(`AIが${c.label}を考えています…`, sig => gemini(mealSuggestPrompt(c, wish.trim()), [], sig), 'text');
    if (!r?.options?.length) return;
    openSheet(`${c.label}の提案`, `
      <p class="small">目安：あと約 <b>${r0(c.kcal)}kcal</b>・たんぱく質 ${r0(c.protein)}g・脂質 ${r0(c.fat)}g</p>
      ${r.advice ? `<div class="hint small">💬 ${h(r.advice)}</div>` : ''}
      ${r.options.map(o => `<div class="ex"><div class="ex-name">${h(o.name)} <span class="tag">${h(o.type || '')}</span></div>
        <div class="small">${h(o.detail || '')}</div>
        <div class="muted">${r0(num(o.kcal))}kcal・P${r0(num(o.protein))} F${r0(num(o.fat))} C${r0(num(o.carbs))}</div>
        ${o.point ? `<div class="small">💡 ${h(o.point)}</div>` : ''}</div>`).join('')}`);
  },
  shareNew: () => shareSheet(),
  shareMode: el => { draft.mode = el.dataset.v; renderShare(); },
  shareFactor: el => { draft.factor = +el.dataset.v; renderShare(); },
  shareRough: el => { draft.rough = +el.dataset.v; renderShare(); },
  sharePeople: el => { draft.people = Math.max(1, Math.min(30, draft.people + +el.dataset.v)); renderShare(); },
  shareDrink(el) {
    const k = el.dataset.k;
    draft.drinks[k] = Math.max(0, (draft.drinks[k] || 0) + +el.dataset.v);
    renderShare();
  },
  async shareRun() {
    const d = draft, drinks = drinkItems();
    if (d.mode === 'rough') {
      const [, label, kcal0, p, f, c] = SHOPS.find(x => x[0] === d.shop);
      const kcal = Math.round(kcal0 * d.rough);
      const amount = ROUGH_AMOUNTS.find(x => x[0] === d.rough)[1];
      const food = { name: `${label}の料理（ざっくり）`, amount: `自分の分・${amount}`, kcal, protein: Math.round(kcal * p / 100 / 4), fat: Math.round(kcal * f / 100 / 9), carbs: Math.round(kcal * c / 100 / 4) };
      closeSheet();
      mealSheet(newMeal({ type: 'dinner', name: `${label}（ざっくり）`, items: [food, ...drinks], note: `${label}の1人前の目安（${amount}）から計算したざっくりの値です。` }), true);
      return;
    }
    const [file, ...more] = await pickPhotos(true);
    if (!file) return;
    const imgs = await filesToImages([file, ...more], 1600, 1, 4);
    const r = await runAI(d.mode === 'receipt' ? 'AIがレシートを読み取り中…' : 'AIが料理を分析中…', sig => gemini(sharePrompt(d.mode, d.people), imgs, sig), 'meal');
    if (!r) return;
    const m = normalizeMeal(r);
    const share = d.factor / d.people;
    const amount = SHARE_AMOUNTS.find(x => x[0] === d.factor)[1];
    // テーブル全体の値を、自分の分（人数で割って、食べた量を掛ける）にする
    const items = m.items.map(i => ({ ...i, amount: `全体${i.amount ? '：' + i.amount : ''} の約${Math.round(share * 100)}%`,
      kcal: Math.round(i.kcal * share), protein: Math.round(i.protein * share * 10) / 10, fat: Math.round(i.fat * share * 10) / 10, carbs: Math.round(i.carbs * share * 10) / 10 }));
    const thumb = await resizeImage(imgs[0], 360, 0.7);
    closeSheet();
    mealSheet(newMeal({ type: 'dinner', name: `${m.name}（${d.people}人・${amount}）`, items: [...items, ...drinks], thumb,
      note: `テーブル全体で約${r0(sum(m.items, 'kcal'))}kcal を ${d.people}人で分けて、自分は「${amount}」として計算しました。${m.note || ''}` }), true);
  },
  mealManual: () => mealSheet(newMeal({ name: '', items: [{ name: '', amount: '', kcal: 0, protein: 0, fat: 0, carbs: 0 }] }), true),
  mealFav() {
    if (!S.favorites.length) { alert('お気に入りはまだありません。\n食事を記録するときに「⭐ お気に入りに追加」を押すと、次から1タップで記録できます。'); return; }
    openSheet('お気に入りから記録', `<ul class="list">${S.favorites.map(f => `
      <li><div class="grow tap" data-act="favUse" data-id="${f.id}"><div class="title">${h(f.name)}</div><div class="muted">${r0(f.kcal)} kcal ・ P ${r0(f.protein)} / F ${r0(f.fat)} / C ${r0(f.carbs)}</div></div>
      <button class="icon-btn" data-act="favDelete" data-id="${f.id}" aria-label="お気に入りから外す">🗑</button></li>`).join('')}</ul>`);
  },
  favUse(el) {
    const f = S.favorites.find(x => x.id === el.dataset.id);
    closeSheet();
    mealSheet(newMeal({ name: f.name, items: structuredClone(f.items), thumb: f.thumb || '' }), true);
  },
  async favDelete(el) {
    if (!confirm('このお気に入りを外しますか？（記録済みの食事は消えません）')) return;
    S.favorites = S.favorites.filter(x => x.id !== el.dataset.id);
    await save('favorites');
    ACT.mealFav();
  },
  mealEdit: el => mealSheet(S.meals.find(m => m.id === el.dataset.id), false),
  mealScale(el) {
    const f = +el.dataset.f;
    for (const it of draft.items) for (const k of ['kcal', 'protein', 'fat', 'carbs']) it[k] = Math.round(it[k] * f * 10) / 10;
    renderMealItems();
  },
  mealAddItem: () => { draft.items.push({ name: '', amount: '', kcal: 0, protein: 0, fat: 0, carbs: 0 }); renderMealItems(); },
  mealDelItem: el => { draft.items.splice(+el.dataset.i, 1); renderMealItems(); },
  async mealSave() {
    const m = recalcMeal({ ...draft, type: $('#m-type').value, date: $('#m-date').value || mealDate, name: $('#m-name').value.trim() || draft.items.map(i => i.name).join('・') || '食事' });
    delete m._isNew;
    if (draft._isNew) { m.created = Date.now(); S.meals.push(m); }
    else S.meals = S.meals.map(x => (x.id === m.id ? m : x));
    await save('meals');
    mealDate = m.date;
    closeSheet();
    const streak = m.date === ymd() && mealsOn(ymd()).length === 1 ? mealStreak() : 0;
    toast(streak >= 2 ? `保存しました！食事の記録 ${streak}日連続です 🔥` : `保存しました（${r0(m.kcal)} kcal）`);
    render();
  },
  async mealDelete() {
    if (!confirm('この食事の記録を削除しますか？')) return;
    S.meals = S.meals.filter(x => x.id !== draft.id);
    await save('meals');
    closeSheet();
    render();
  },
  async mealToFav() {
    recalcMeal(draft);
    const name = $('#m-name').value.trim() || draft.items.map(i => i.name).join('・');
    S.favorites.push({ id: uid(), name, items: structuredClone(draft.items), kcal: draft.kcal, protein: draft.protein, fat: draft.fat, carbs: draft.carbs, thumb: draft.thumb || '' });
    await save('favorites');
    toast('お気に入りに追加しました');
  },

  // ---- 体 ----
  bodyReadPhoto(el) {
    const src = el.dataset.src;
    if (src === 'inbody') {
      openSheet('InBodyの結果を取り込む', `
        <h4>おすすめ: 画面収録で1回撮るだけ</h4>
        <ol class="small">
          <li>InBodyアプリで結果画面を開く</li>
          <li>画面の右上から下にスワイプして「コントロールセンター」を出し、⏺（画面収録）を押す</li>
          <li>3秒後に録画が始まるので、結果画面を<b>ゆっくり下までスクロール</b></li>
          <li>画面上の赤い部分をタップして録画を止める</li>
          <li>下のボタンで、その動画を選ぶ</li>
        </ol>
        <p class="muted">⏺が見つからないときは、iPhoneの「設定」→「コントロールセンター」で「画面収録」を追加してください。</p>
        <h4>スクリーンショットでもOK</h4>
        <p class="small">何枚かあっても、まとめて選べます。1枚目の画面（体重・骨格筋量・体脂肪率）だけでも記録できます。</p>
        <button class="btn primary block" data-act="bodyReadFiles" data-src="inbody">動画・スクショを選ぶ</button>
        <h4>過去の記録をまとめて取り込む</h4>
        <p class="small">InBodyアプリから書き出したCSVファイルを選ぶと、全部の記録をまとめて取り込みます（AIは使いません）。前に取り込んだ記録は重複しません。</p>
        <button class="btn block" data-act="inbodyCsv">📄 CSVファイルを選ぶ</button>`);
      return;
    }
    ACT.bodyReadFiles(el);
  },
  async bodyReadFiles(el) {
    const src = el.dataset.src;
    const files = await pickPhotos(true, src === 'inbody' ? 'image/*,video/*' : 'image/*');
    if (!files.length) return;
    let imgs;
    busy(true, '画像を準備中…');
    try { imgs = await filesToImages(files); }
    catch (e) { alert(e.message || '画像を読み込めませんでした'); return; }
    finally { busy(false); }
    const r = await runAI('AIが数値を読み取り中…', sig => gemini(bodyReadPrompt(src, imgs.length), imgs, sig), 'body', imgs.length);
    if (!r) return;
    const b = { id: uid(), source: src, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : ymd(), note: r.note || '', extra: r.extra || {} };
    for (const [k] of BODY_FIELDS) b[k] = num(r[k]);
    bodySheet(b, true);
  },
  bodyQuick: () => openSheet('体重を記録', `
    <p class="small">家庭の体重計の画面（またはアプリの画面）を撮ると、AIが数値を読み取ります。</p>
    <button class="btn primary block" data-act="bodyReadPhoto" data-src="tanita">📷 画面を撮って読み取る</button>
    <button class="btn block" data-act="bodyReadPhoto" data-src="inbody" style="margin-top:8px">📱 InBodyを取り込む</button>
    <button class="btn block" data-act="bodyManual" style="margin-top:8px">✏️ 手で入力</button>`),
  async inbodyCsv() {
    const [file] = await pickPhotos(false, '.csv,text/csv,text/comma-separated-values');
    if (!file) return;
    const list = parseInbodyCsv(await file.text());
    if (!list) { alert('InBodyのCSVとして読み取れませんでした。InBodyアプリから書き出したファイルを選んでください。'); return; }
    const have = new Set(S.body.map(b => b.id));
    const fresh = list.filter(b => !have.has(b.id));
    if (!fresh.length) { alert(`${list.length}件の記録がありましたが、すべて取り込み済みです。`); return; }
    const dates = fresh.map(b => b.date).sort();
    if (!confirm(`${list.length}件の記録が見つかりました。\nそのうち新しい ${fresh.length}件（${jpDate(dates[0])}〜${jpDate(dates.at(-1))}）を取り込みますか？`)) return;
    S.body.push(...fresh);
    await save('body');
    closeSheet();
    toast(`${fresh.length}件取り込みました`);
    render();
  },
  bodyManual: () => bodySheet({ id: uid(), source: 'tanita', date: ymd(), extra: {} }, true),
  bodyEdit: el => bodySheet(S.body.find(b => b.id === el.dataset.id), false),
  async bodySave() {
    const b = { ...draft, date: $('#b-date').value || ymd(), source: $('#b-source').value };
    for (const [k] of BODY_FIELDS) { const i = $(`#b-${k}`); if (i) b[k] = num(i.value); }
    delete b._isNew;
    if (b.weight == null && b.fatPct == null) { alert('体重か体脂肪率を入れてください'); return; }
    if (draft._isNew) { b.created = Date.now(); S.body.push(b); }
    else S.body = S.body.map(x => (x.id === b.id ? b : x));
    await save('body');
    closeSheet();
    toast('保存しました');
    render();
  },
  async bodyDelete() {
    if (!confirm('この測定記録を削除しますか？')) return;
    S.body = S.body.filter(x => x.id !== draft.id);
    await save('body');
    closeSheet();
    render();
  },
  bodyAnalyze: () => analyzeSheet(),
  async slotPick(el) {
    const k = el.dataset.k;
    const [file] = await pickPhotos();
    if (!file) return;
    draft.photos[k] = await fileToJpeg(file, 1280);
    $(`#slot-${k}`).innerHTML = `<img src="${draft.photos[k]}" alt="">`;
  },
  async analyzeRun() {
    const chosen = SLOTS.filter(([k]) => draft.photos[k]);
    if (!chosen.length) { alert('写真を1枚以上選んでください'); return; }
    const imgs = chosen.map(([k]) => draft.photos[k]);
    const r = await runAI('AIが体を分析中…\n（少し時間がかかります）', sig => gemini(analyzePrompt(chosen.map(c => c[1])), imgs, sig), 'analyze', imgs.length);
    if (!r) return;
    const photos = await Promise.all(imgs.map(i => resizeImage(i, 400, 0.7)));
    const a = { id: uid(), date: ymd(), photos, result: r };
    S.analyses.push(a);
    await save('analyses');
    render();
    openSheet(`分析結果 ${jpDate(a.date)}`, analysisHtml(a) + `
      <div class="hint small">この分析をもとにトレーニングメニューを作り直せます。</div>
      <button class="btn primary block" data-act="planAI">🤖 この分析でメニューを作る</button>`);
  },
  analysisView(el) {
    const a = S.analyses.find(x => x.id === el.dataset.id);
    openSheet(`分析結果 ${jpDate(a.date)}`, analysisHtml(a) + '<button class="btn danger block" data-act="analysisDelete" style="margin-top:12px">この分析を削除</button>');
    draft = { id: a.id };
  },
  async analysisDelete() {
    if (!confirm('この分析結果を削除しますか？')) return;
    S.analyses = S.analyses.filter(x => x.id !== draft.id);
    await save('analyses');
    closeSheet();
    render();
  },

  // ---- トレーニング ----
  async planAI() {
    const r = await runAI('AIがメニューを作成中…\n（少し時間がかかります）', sig => gemini(planPrompt(), [], sig), 'plan');
    if (!r?.days?.length) return;
    S.plan = {
      source: 'ai', createdAt: ymd(),
      days: r.days.map(d => ({ name: String(d.name), focus: d.focus || '', estMin: num(d.estMin), cardio: d.cardio && num(d.cardio.min) ? { type: String(d.cardio.type || '有酸素運動'), min: num(d.cardio.min), note: d.cardio.note || '' } : null, exercises: (d.exercises || []).map(e => ({ name: String(e.name), sets: num(e.sets) || 3, reps: String(e.reps ?? ''), rest: e.rest || '', weight: e.weight || '', progression: e.progression || '', alt: e.alt ? String(e.alt) : '', note: e.note || '' })) })),
      tips: r.tips || [],
    };
    await save('plan');
    closeSheet();
    tab = 'train';
    render();
    toast('新しいメニューを作りました');
  },
  async planDefault() {
    if (!confirm('基本メニューに戻しますか？（今のAIメニューは消えます）')) return;
    S.plan = null;
    await save('plan');
    render();
  },
  kmemoGuide: () => openSheet('筋トレメモから取り込む', `
    <ol class="small">
      <li>筋トレメモで、記録が日付ごとに並んでいる画面（種目・重さ・回数が見える画面）を開く</li>
      <li>コントロールセンターから⏺（画面収録）を押す</li>
      <li>録画が始まったら、<b>ゆっくり</b>スクロール（直近1〜2か月分くらいで十分です）。詳しい画面を開く必要がある場合は、開いて少し止まってから次へ</li>
      <li>画面上の赤い部分をタップして止める</li>
      <li>下のボタンで、その動画を選ぶ</li>
    </ol>
    <p class="muted">スクリーンショットを何枚か選んでもOKです。読み取った内容は、保存する前に確認できます。</p>
    <button class="btn primary block" data-act="kmemoPick">動画・スクショを選ぶ</button>`),
  async kmemoPick() {
    const files = await pickPhotos(true, 'image/*,video/*');
    if (!files.length) return;
    let imgs;
    busy(true, '画像を準備中…');
    try { imgs = await filesToImages(files, 1600, 24, 30); }
    catch (e) { alert(e.message || '画像を読み込めませんでした'); return; }
    finally { busy(false); }
    const r = await runAI('AIがトレーニング記録を読み取り中…\n（少し時間がかかります）', sig => gemini(kmemoPrompt(imgs.length), imgs, sig), 'kmemo', imgs.length);
    if (!r) return;
    const sessions = (r.sessions || []).map(x => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : null,
      exercises: (x.exercises || []).map(e => ({
        name: String(e.name || '').trim(),
        sets: (e.sets || []).map(t => ({ w: num(t.w) ?? 0, r: num(t.r) })).filter(t => t.r != null),
      })).filter(e => e.name && e.sets.length),
    })).filter(x => x.exercises.length);
    if (!sessions.length) { alert('トレーニング記録を読み取れませんでした。種目・重さ・回数が見える画面で、もう一度試してください。'); return; }
    const sig = w => w.date + '|' + w.exercises.map(e => e.name).sort().join(',');
    const have = new Set(S.workouts.map(sig));
    draft = {
      fresh: sessions.map(x => ({ id: uid(), date: x.date || ymd(), dayName: x.date ? '筋トレメモから' : '筋トレメモから（日付不明）', source: 'kmemo', exercises: x.exercises }))
        .filter(w => !have.has(sig(w))),
    };
    if (!draft.fresh.length) { alert('読み取った記録は、すべて取り込み済みでした。'); return; }
    draft.fresh.sort((a, b) => a.date.localeCompare(b.date));
    openSheet('読み取った記録', `
      ${r.note ? `<div class="hint small">AIのメモ: ${h(r.note)}</div>` : ''}
      <p class="small">${draft.fresh.length}回分の記録を読み取りました。内容を確認してください（間違いはあとで記録一覧から直せます）。</p>
      ${draft.fresh.map(w => `<div class="ex"><div class="ex-name">${jpDate(w.date)}${w.dayName.includes('不明') ? ' <span class="tag">日付不明</span>' : ''}</div>
        ${w.exercises.map(e => `<div class="small">${h(e.name)}：<span class="muted">${h(setsText(e.sets))}</span></div>`).join('')}</div>`).join('')}
      <button class="btn primary block" data-act="kmemoSave" style="margin-top:12px">取り込む</button>`);
  },
  async kmemoSave() {
    const n = draft.fresh.length;
    S.workouts.push(...draft.fresh.map((w, i) => ({ ...w, created: Date.now() + i })));
    await save('workouts');
    closeSheet();
    render();
    if (confirm(`${n}回分を取り込みました。\nこの記録をもとに、AIで重さ入りのメニューを作りますか？`)) ACT.planAI();
  },
  startWorkout: () => (todayDraft() ? resumeDraft() : workoutSheet(workoutFromPlanDay(adjustDay(nextPlanDay())), true)),
  async recordStart(el) {
    const t = todayInput();
    if (t.place !== el.dataset.v) {
      S.today = { date: ymd(), minutes: t.minutes, cond: t.cond, memo: t.memo, aiDay: null, place: el.dataset.v };
      await save('today');
      render();
    }
    ACT.startWorkout();
  },
  startDay(el) {
    if (todayDraft()) return resumeDraft(el.dataset.ex);
    const day = currentPlan().days[+el.dataset.i];
    workoutSheet(workoutFromPlanDay(el.dataset.today ? adjustDay(day) : day), true);
    scrollToEx(el.dataset.ex);
  },
  resumeDraft: () => resumeDraft(),
  async todayAI() {
    const t = { ...todayInput(), memo: $('#today-memo').value.trim() };
    const day = nextPlanDay();
    const r = await runAI('AIが今日のメニューを調整中…', sig => gemini(todayPrompt(day, t), [], sig), 'plan');
    if (!r?.exercises) return;
    const aiDay = {
      ...day, focus: r.focus || day.focus, estMin: num(r.estMin), advice: r.advice || '',
      cardio: r.cardio && num(r.cardio.min) ? { type: String(r.cardio.type || '有酸素運動'), min: num(r.cardio.min), note: r.cardio.note || '' } : null,
      exercises: r.exercises.map(e => ({ name: String(e.name), sets: num(e.sets) || 3, reps: String(e.reps ?? ''), rest: e.rest || '', weight: e.weight || '', alt: e.alt ? String(e.alt) : '', note: e.note || '', adj: true })),
    };
    S.today = { date: ymd(), minutes: t.minutes, cond: t.cond, memo: t.memo, aiDay, place: 'gym' };
    await save('today');
    render();
    toast('今日のメニューを調整しました');
  },
  habitNew: el => habitSheet(CATALOG.find(c => c.id === el.dataset.id)),
  habitAddSet: () => { draft.sets.push({ r: null }); renderHabitSets(); },
  habitDelSet: el => { draft.sets.splice(+el.dataset.i, 1); renderHabitSets(); },
  async habitSave() {
    const sets = draft.sets.filter(x => num(x.r) > 0);
    if (!sets.length) { alert('回数を入れてください'); return; }
    S.habits = [...(S.habits || []).filter(x => x.id !== draft.id), { id: draft.id, date: ymd(), name: draft.name, sets, created: Date.now() }];
    await save('habits');
    const streak = habitStreak(draft.name);
    closeSheet();
    render();
    toast(streak >= 2 ? `記録しました！${streak}日連続です 🔥` : '記録しました！');
  },
  async todayPlace(el) {
    const t = todayInput();
    S.today = { date: ymd(), minutes: t.minutes, cond: t.cond, memo: t.memo, aiDay: null, place: el.dataset.v };
    await save('today');
    const y = window.scrollY; render(); window.scrollTo(0, y);
    toast(el.dataset.v === 'home' ? '今日は宅トレのメニューにしました' : 'ジムのメニューに戻しました');
  },
  async todayReset() {
    S.today = null;
    await save('today');
    render();
  },
  startCardio: () => workoutSheet({ id: uid(), date: ymd(), dayName: '有酸素運動', unit: S.settings.unit, exercises: [], cardio: [{ type: CARDIO_TYPES[0], min: null }] }, true),
  workoutUnit(el) {
    draft.unit = el.dataset.u;
    $$('#w-unit button').forEach(b => b.classList.toggle('on', b.dataset.u === draft.unit));
    renderWorkoutList();
  },
  cardioAdd: () => { draft.cardio.push({ type: draft.cardio.at(-1)?.type || CARDIO_TYPES[0], min: null }); renderCardio(); },
  cardioDel: el => { draft.cardio.splice(+el.dataset.c, 1); renderCardio(); },
  workoutEdit: el => workoutSheet(S.workouts.find(w => w.id === el.dataset.id), false),
  workoutAddEx() {
    const name = $('#w-newex').value.trim();
    if (!name) return;
    addExercise(name);
    $('#w-newex').value = '';
    $('#w-other').hidden = true;
  },
  workoutSwap(el) {
    const e = draft.exercises[+el.dataset.e];
    const [from, to] = [e.name, e.alt];
    const last = lastPerf(to);
    const c = catalogFor(to);
    Object.assign(e, { name: to, alt: from, weight: '', reps: c?.reps || e.reps, target: `${e.sets.length}×${c?.reps || e.reps}` });
    e.sets = e.sets.map((s, i) => ({ w: last ? (last.sets[i] || last.sets.at(-1)).w : null, r: null }));
    renderWorkoutList();
    toast(`「${to}」に変えました（もう一度押すと戻せます）`);
  },
  workoutDelEx: el => { draft.exercises.splice(+el.dataset.e, 1); renderWorkoutList(); },
  workoutAddSet(el) {
    const sets = draft.exercises[+el.dataset.e].sets;
    sets.push({ w: sets.at(-1)?.w ?? null, r: null });
    renderWorkoutList();
  },
  workoutDelSet: el => { draft.exercises[+el.dataset.e].sets.splice(+el.dataset.s, 1); renderWorkoutList(); },
  async workoutImage() {
    const files = await pickPhotos(true, 'image/*,video/*');
    if (!files.length) return;
    let imgs;
    busy(true, '画像を準備中…');
    try { imgs = await filesToImages(files, 1600, 12, 12); }
    catch (e) { alert(e.message || '画像を読み込めませんでした'); return; }
    finally { busy(false); }
    const r = await runAI('AIが記録を読み取り中…', sig => gemini(kmemoPrompt(imgs.length), imgs, sig), 'kmemo', imgs.length);
    if (!r) return;
    const sessions = (r.sessions || []).filter(x => x.exercises?.length);
    if (!sessions.length) { alert('トレーニング記録を読み取れませんでした。種目・重さ・回数が見える画面で試してください。'); return; }
    // 記録の日付と同じ日 → 無ければ一番新しい日の記録を使う
    const date = $('#w-date').value || ymd();
    const sess = sessions.find(x => x.date === date) || [...sessions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    let updated = 0, added = 0;
    for (const e of sess.exercises) {
      const sets = (e.sets || []).map(t => ({ w: num(t.w) ?? 0, r: num(t.r) })).filter(t => t.r != null);
      if (!e.name || !sets.length) continue;
      const hit = draft.exercises.find(x => x.name === e.name) || draft.exercises.find(x => normName(x.name) === normName(e.name));
      if (hit) { hit.sets = sets; updated++; }
      else { draft.exercises.push({ name: String(e.name), reps: '', target: '', sets }); added++; }
    }
    renderWorkoutList();
    toast(`読み取りました（${updated}種目を入力・${added}種目を追加）`);
  },
  // 途中保存：画面は閉じずに、そこまでの記録を残す
  async workoutSaveEx(el) {
    const e = draft.exercises[+el.dataset.e];
    if (!e.sets.some(s => num(s.r) != null)) { alert('「回数」を入れてから保存してください'); return; }
    e._saved = true;
    if (!(await storeWorkout(false))) return;
    renderWorkoutList();
    toast(`「${e.name}」を保存しました`);
    // 次のまだの種目へ
    const next = draft.exercises.findIndex(x => !x._saved);
    if (next >= 0) $$('#w-list > .ex')[next]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  async workoutSaveMid() {
    if (!(await storeWorkout(false))) return;
    toast('途中まで保存しました。続きはいつでも入れられます');
  },
  async workoutSave() {
    const isNew = draft._open;
    const w = await storeWorkout(true);
    if (!w) return;
    closeSheet();
    render();
    if (w.exercises.length && isNew) {
      openSheet('💪 おつかれさまでした！', `<div class="praise">${workoutPraise(w).map(l => `<p>${l}</p>`).join('')}</div>`);
    } else toast('おつかれさまでした！記録しました');
  },
  async workoutDelete() {
    if (!confirm('このトレーニング記録を削除しますか？')) return;
    if (draft._isNew) { closeSheet(); return; }
    S.workouts = S.workouts.filter(x => x.id !== draft.id);
    await save('workouts');
    closeSheet();
    render();
  },

  // ---- 自転車 ----
  rideNew: () => rideSheet(),
  healthImport: () => openSheet('Apple Watchの記録を取り込む', `
    <p class="small">取り込み方は2つあります。どちらか使いやすい方を選んでください。</p>
    <h4 class="method">方法1：スクショで取り込む（準備なし）</h4>
    <p class="small">サイクリング・ランニング・ウォーキングのワークアウトをまとめて取り込めます。</p>
    <ol class="small">
      <li>iPhoneの「<b>フィットネス</b>」アプリを開く</li>
      <li>「概要」画面の「<b>セッション</b>」の欄にある「<b>＞</b>」を押し、ワークアウトが日付ごとに並んだ一覧を開く</li>
      <li>記録が写るように<b>スクショ</b>を撮る（何枚でもOK。画面収録でスクロールしてもOK）。距離が出ていなければ、ワークアウトをタップした詳しい画面でもOK</li>
      <li>下のボタンで、そのスクショを選ぶ</li>
    </ol>
    <p class="muted">距離・時間・消費カロリーをAIが読み取ります。Apple Watchが測った消費カロリーをそのまま使うので、計算より正確です。</p>
    <button class="btn primary block" data-act="watchPick">スクショを選ぶ</button>
    <h4 class="method">方法2：ショートカットで取り込む（最初に1回作れば、毎回ボタン1つ）</h4>
    <details class="small"><summary>ショートカットの作り方を開く（タップ）</summary>${healthGuideHtml()}</details>
    <button class="btn primary block" data-act="runShortcut" style="margin-top:8px">▶ ショートカットを実行して取り込む</button>
    <button class="btn block" data-act="healthPaste" style="margin-top:8px">コピー済みの記録を取り込む</button>
    <p class="muted">「▶」を押すとショートカットアプリが開いて自動で実行されます。bodymakeに戻ると「取り込む」ボタンが出ます。ショートカットの名前を変えた場合は、設定の「Apple Watch」で名前を合わせてください。</p>`),
  async watchPick() {
    const files = await pickPhotos(true, 'image/*,video/*');
    if (!files.length) return;
    let imgs;
    busy(true, '画像を準備中…');
    try { imgs = await filesToImages(files, 1600, 12, 12); }
    catch (e) { alert(e.message || '画像を読み込めませんでした'); return; }
    finally { busy(false); }
    const r = await runAI('AIがワークアウトを読み取り中…', sig => gemini(watchPrompt(imgs.length), imgs, sig), 'body', imgs.length);
    if (!r) return;
    const all = (r.workouts || r.rides || []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') && (num(x.km) > 0 || num(x.min) > 0));
    if (!all.length) { alert('ワークアウトの記録を読み取れませんでした。種類・日付・距離が写っている画面で試してください。'); return; }
    const rides = all.filter(x => (x.type || 'cycling') === 'cycling' && num(x.km) > 0);
    const others = all.filter(x => x.type === 'running' || x.type === 'walking');
    const label = x => x.type === 'running' ? (x.indoor ? 'トレッドミル（ウォーキング・ランニング）' : 'ランニング（屋外）') : x.type === 'walking' ? (x.indoor ? 'トレッドミル（ウォーキング・ランニング）' : 'ウォーキング（屋外）') : 'サイクリング';
    const list = [...rides, ...others].map(x => `${jpDate(x.date)} ${x.type === 'running' ? '🏃' : x.type === 'walking' ? '🚶' : '🚲'} ${num(x.km) ? r1(num(x.km)) + 'km' : ''}${num(x.min) ? ` ${r0(num(x.min))}分` : ''}${num(x.kcal) ? ` ${r0(num(x.kcal))}kcal` : ''}`).join('\n');
    if (!confirm(`${rides.length + others.length}件のワークアウトを読み取りました。\n\n${list}\n${r.note ? '\n（AIのメモ: ' + r.note + '）\n' : ''}\n取り込みますか？`)) return;
    // ランニング・ウォーキングは、その日の「有酸素運動（Apple Watch）」の記録にまとめる
    for (const x of others) {
      const id = 'awc-' + x.date;
      let w = S.workouts.find(y => y.id === id);
      if (!w) { w = { id, date: x.date, dayName: '有酸素運動（Apple Watch）', exercises: [], cardio: [], created: parseYmd(x.date).getTime() }; S.workouts.push(w); }
      const c = { type: label(x), min: num(x.min) ? Math.round(num(x.min)) : null, km: num(x.km), kcal: num(x.kcal) ? Math.round(num(x.kcal)) : null };
      const key = y => `${y.type}|${y.km}|${y.min}`;
      if (!w.cardio.some(y => key(y) === key(c))) w.cardio.push(c);
    }
    for (const x of rides) {
      const km = Math.round(num(x.km) * 100) / 100;
      const ride = { id: `aw-${x.date}-${km}`, date: x.date, km, min: num(x.min), bike: S.settings.bike, label: 'Apple Watch', source: 'watch', created: Date.now() };
      ride.kcal = num(x.kcal) ? Math.round(num(x.kcal)) : rideKcal(km, ride.min, ride.bike);
      // 同じワークアウトの読み直しと、ショートカットで入れた同じ日の分は置き換える
      S.rides = S.rides.filter(y => y.id !== ride.id && y.id !== 'hk-' + x.date);
      S.rides.push(ride);
    }
    await save('rides', 'workouts');
    closeSheet();
    toast(`${rides.length + others.length}件取り込みました`);
    render();
  },
  healthPasteClose() { closeSheet(); ACT.healthPaste(); },
  runShortcut() {
    // 戻ってきたときに「取り込む」ボタンを出すため、実行した時刻を覚えておく
    try { localStorage.setItem('bodymake-hk-pending', String(Date.now())); } catch {}
    location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(S.settings.shortcutName || 'bodymake用にコピー');
  },
  chartTap(el, e) {
    const c = CHARTS[el.dataset.chart];
    if (!c) return;
    const r = el.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * c.W;
    const vy = ((e.clientY - r.top) / r.height) * (c.W * r.height / r.width);
    // 横の位置が一番近い点（同じ日に2本の線があれば、縦の位置も近いほう）
    const p = c.pts.reduce((best, q) => (Math.abs(q.vx - vx) + Math.abs(q.vy - vy) * 0.2 < Math.abs(best.vx - vx) + Math.abs(best.vy - vy) * 0.2 ? q : best));
    const line = el.querySelector('.sel-line'), dot = el.querySelector('.sel-dot');
    line.setAttribute('x1', p.vx); line.setAttribute('x2', p.vx); line.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', p.vx); dot.setAttribute('cy', p.vy); dot.setAttribute('visibility', 'visible');
    const b = S.body.find(x => x.id === p.id);
    $('#tip-' + el.dataset.chart).innerHTML = b ? bodyTipText(b) : `<b>${jpDate(p.d)}</b>　${r1(p.y)}${c.unit}`;
  },
  async healthPaste() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch {}
    if (!/BODYMAKE/i.test(text)) text = prompt('コピーした内容を貼り付けてください（長押し→ペースト）', '') || '';
    if (text) importHealth(text);
  },
  pickExercises: () => pickSheet(),
  pickPart(el) {
    $$(`input[data-part="${el.dataset.part}"]:not(:disabled)`).forEach(i => { i.checked = el.dataset.on === '1'; });
  },
  pinToggle(el) {
    const id = el.dataset.id;
    if (draft.pins.has(id)) draft.pins.delete(id); else draft.pins.add(id);
    el.classList.toggle('on', draft.pins.has(id));
    const box = $(`input[data-pick="${id}"]`);
    if (draft.pins.has(id) && box) box.checked = true;
  },
  async pickSave() {
    const ids = $$('input[data-pick]:checked').map(i => i.dataset.pick);
    if (!ids.length) { alert('種目を1つ以上選んでください'); return; }
    // 📌を付けた種目は、選んだ種目にも入れる
    S.settings.pinned = [...draft.pins];
    S.settings.chosen = [...new Set([...ids, ...draft.pins])];
    await save('settings');
    closeSheet();
    render();
    if (S.plan?.source === 'ai' && confirm('選んだ種目でAIのメニューを作り直しますか？\n（「キャンセル」なら今のAIメニューのまま。基本メニューに戻すと、選んだ種目ですぐに組み直されます）')) ACT.planAI();
    else toast('保存しました');
  },
  async rideRoute(el) {
    const r = S.settings.routes[+el.dataset.i];
    const km = r.round ? r.km * 2 : r.km;
    const ride = { id: uid(), date: ymd(), km, min: null, bike: S.settings.bike, label: r.name + (r.round ? '（往復）' : ''), created: Date.now() };
    ride.kcal = rideKcal(km, null, ride.bike);
    S.rides.push(ride);
    await save('rides');
    toast(`${ride.label} ${r1(km)}km・約${ride.kcal}kcal を記録しました`);
    render();
  },
  async rideDelete(el) {
    const r = S.rides.find(x => x.id === el.dataset.id);
    if (!confirm(`${r.label || '自転車'} ${r1(r.km)}km の記録を削除しますか？`)) return;
    S.rides = S.rides.filter(x => x.id !== r.id);
    await save('rides');
    render();
  },
  async rideSave() {
    const km0 = num($('#r-km').value);
    if (!km0) { alert('距離を入れてください'); return; }
    const round = $('#r-round').checked;
    const km = round ? km0 * 2 : km0;
    const min = num($('#r-min').value);
    const bike = $('#r-bike').value;
    const name = $('#r-name').value.trim();
    const ride = { id: uid(), date: $('#r-date').value || ymd(), km, min: min ? (round ? min * 2 : min) : null, bike, label: (name || '自転車') + (round ? '（往復）' : ''), created: Date.now() };
    ride.kcal = rideKcal(ride.km, ride.min, bike);
    S.rides.push(ride);
    await save('rides');
    if ($('#r-keep').checked && name) {
      S.settings.routes.push({ name, km: km0, round });
      await save('settings');
    }
    closeSheet();
    toast(`${r1(km)}km・約${ride.kcal}kcal を記録しました`);
    render();
  },
  async routeDelete(el) {
    const r = S.settings.routes[+el.dataset.i];
    if (!confirm(`ルート「${r.name}」を一覧から外しますか？（これまでの記録は消えません）`)) return;
    S.settings.routes.splice(+el.dataset.i, 1);
    await save('settings');
    render();
  },

  // ---- 設定 ----
  async targetAI() {
    const r = await runAI('AIが目標の数値を考えています…', sig => gemini(targetPrompt(), [], sig), 'plan');
    if (!r || (!num(r.weight) && !num(r.fatPct))) return;
    draft = { proposal: r };
    openSheet('AIからの目標の提案', `
      <div class="grid2" style="text-align:center">
        <div class="stat"><span>目標の体重</span><b>${r1(num(r.weight))}<small>kg</small></b></div>
        <div class="stat"><span>目標の体脂肪率</span><b>${r1(num(r.fatPct))}<small>%</small></b></div>
      </div>
      ${num(r.skeletalMuscle) ? `<p class="small" style="text-align:center">骨格筋量の目標 <b>${r1(num(r.skeletalMuscle))}kg</b></p>` : ''}
      ${r.weeklyPace ? `<p class="small">📈 ペース：${h(r.weeklyPace)}</p>` : ''}
      <div class="hint small">💬 ${h(r.reason || '')}</div>
      ${r.steps?.length ? `<h4>途中の目安</h4><ul class="plain small">${r.steps.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
      <button class="btn primary block" data-act="targetAccept">この目標にする</button>`);
  },
  async targetAccept() {
    const r = draft.proposal;
    S.settings.target = { weight: num(r.weight), fatPct: num(r.fatPct), skeletalMuscle: num(r.skeletalMuscle), reason: r.reason || '', weeklyPace: r.weeklyPace || '', steps: r.steps || [], source: 'ai', date: ymd(),
      startWeight: num(latestWith('weight')?.weight), startFat: num(latestWith('fatPct')?.fatPct) };
    await save('settings');
    closeSheet();
    render();
    toast('目標の数値を保存しました');
  },
  async targetRestart() {
    S.settings.targetBase = ymd();
    await save('settings');
    toast(`今日から${S.settings.targetMonths}ヶ月後（${ymdText(targetDate())}）までにしました`);
    render();
  },
  async testKey() {
    const r = await runAI('接続テスト中…', sig => gemini('{"ok":true} というJSONだけを返してください。', [], sig), 'test');
    if (r) alert('接続できました！写真のAI分析が使えます。');
  },
  exportData() {
    const data = JSON.stringify({ app: 'bodymake', exportedAt: new Date().toISOString(), ...S, settings: { ...S.settings, apiKey: '' } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `bodymake-backup-${ymd()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  async importData() {
    const file = await new Promise(ok => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.json,application/json';
      i.style.display = 'none';
      i.onchange = () => { ok(i.files[0]); i.remove(); };
      document.body.appendChild(i);
      i.click();
    });
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== 'bodymake') throw new Error();
      if (!confirm('バックアップを読み込むと、今このiPhoneに入っている記録は置き換わります。よろしいですか？')) return;
      const key = S.settings.apiKey;
      for (const k of Object.keys(S)) if (k in d) S[k] = d[k];
      S.settings = mergeSettings(S.settings);
      if (!S.settings.apiKey) S.settings.apiKey = key;
      await save(...Object.keys(S));
      toast('読み込みました');
      render();
    } catch { alert('このファイルは読み込めませんでした（bodymakeのバックアップではないようです）'); }
  },
};

const INPUT = {
  workoutPick(el) {
    const v = el.value;
    el.value = '';
    if (v === '__other') { $('#w-other').hidden = false; $('#w-newex').focus(); return; }
    if (v) addExercise(v);
  },
  foodSearch(el) { draft.res = searchFoods(el.value); renderFoodRes(); },
  foodQty(el) {
    const x = draft.sel[+el.dataset.i], v = num(el.value);
    if (v == null || v < 0) return;
    x.q = v;
    // 入力中に画面を作り直すと文字が消えるので、数字の表示だけ直す
    const it = foodItem(x), items = draft.sel.map(foodItem), tot = k => r0(items.reduce((a, y) => a + y[k], 0));
    $(`#fs-kcal-${el.dataset.i}`).textContent = `${it.amount} ・ ${r0(it.kcal)}kcal（P ${r1(it.protein)} / F ${r1(it.fat)} / C ${r1(it.carbs)}）`;
    $$(`[data-act=foodQty][data-i="${el.dataset.i}"]`).forEach(b => b.classList.toggle('on', +b.dataset.v === v));
    $('#fs-total').innerHTML = `合計 <b>${tot('kcal')}kcal</b> ・ たんぱく質 ${tot('protein')}g ・ 脂質 ${tot('fat')}g ・ 炭水化物 ${tot('carbs')}g`;
  },
  habitSet(el) { draft.sets[+el.dataset.i].r = num(el.value); },
  eventCalc() {
    $('#ev-kcal').innerHTML = `この会食はおよそ <b>${eventKcalCalc()}kcal</b>（料理＋お酒1杯150kcalで計算）`;
  },
  async todayAdj(el) {
    const t = todayInput();
    t[el.dataset.k] = el.dataset.k === 'minutes' ? num(el.value) : el.value;
    S.today = { date: ymd(), minutes: t.minutes, cond: t.cond, memo: t.memo, aiDay: null, place: t.place };
    await save('today');
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },
  ride() {
    const km0 = num($('#r-km').value), min0 = num($('#r-min').value), round = $('#r-round').checked;
    const k = round ? 2 : 1;
    $('#r-preview').innerHTML = km0 ? `消費カロリー: <b>約${rideKcal(km0 * k, min0 ? min0 * k : null, $('#r-bike').value)} kcal</b>（${r1(km0 * k)}km）` : '距離を入れると消費カロリーを計算します';
  },
  mealItem(el) {
    const it = draft.items[+el.dataset.i];
    it[el.dataset.k] = el.dataset.k === 'name' ? el.value : num(el.value) || 0;
    renderMealTotal();
  },
  wset(el) {
    const v = num(el.value);
    draft.exercises[+el.dataset.e].sets[+el.dataset.s][el.dataset.k] = el.dataset.k === 'w' ? fromUnit(v, draft.unit) : v;
  },
  cardio(el) {
    draft.cardio[+el.dataset.c][el.dataset.k] = el.dataset.k === 'type' ? el.value : num(el.value);
  },
  workoutDay(el) {
    const i = +el.value;
    const keep = { id: draft.id, unit: draft.unit, cardio: draft.cardio, _isNew: true };
    draft = i < 0
      ? { ...keep, date: ymd(), dayName: '有酸素運動', exercises: [] }
      : { ...workoutFromPlanDay(currentPlan().days[i]), ...keep };
    if (i < 0 && !draft.cardio.length) draft.cardio.push({ type: CARDIO_TYPES[0], min: null });
    renderWorkoutList();
    renderCardio();
  },
};

async function onSettingChange(el) {
  const st = S.settings;
  if (el.dataset.target) {
    const t = st.target || {};
    t[el.dataset.target] = num(el.value);
    if (!num(t.weight) && !num(t.fatPct)) st.target = null;
    else st.target = { ...t, source: 'manual', reason: '', steps: [], date: ymd(), startWeight: t.startWeight ?? num(latestWith('weight')?.weight), startFat: t.startFat ?? num(latestWith('fatPct')?.fatPct) };
    await save('settings');
    const y = window.scrollY; render(); window.scrollTo(0, y);
    toast('保存しました');
    return;
  }
  if (el.dataset.eq) {
    const k = el.dataset.eq;
    st.equipment = el.checked ? [...new Set([...st.equipment, k])] : st.equipment.filter(x => x !== k);
  } else {
    const path = el.dataset.set.split('.');
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (path[0] === 'goals') v = v.split('\n').map(s => s.trim()).filter(Boolean);
    if (['daysPerWeek', 'weightMin', 'cardioMin'].includes(path[0]) || path[1] === 'activity') v = num(v);
    if (path[0] === 'targetMonths') { v = num(v); st.targetBase = ymd(); }
    if (path[0] === 'targetMode') { if (v === 'date') st.targetDate = targetDate(); else st.targetBase = ymd(); }
    if (path.length === 2) st[path[0]][path[1]] = v; else st[path[0]] = v;
  }
  await save('settings');
  // 目標値の表示を更新（入力中の欄はそのまま）
  if (!el.matches('textarea, input[type=password]')) {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
  toast('保存しました');
}

// ===================== 起動 =====================
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) { tab = tabBtn.dataset.tab; if (tab === 'meals') mealDate = ymd(); render(); return; }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el, e); }
});
function syncDateBox(e) {
  if (e.target.matches?.('.datebox input')) e.target.previousElementSibling.textContent = e.target.value ? ymdText(e.target.value) : '日付を選ぶ';
}
document.addEventListener('input', e => {
  syncDateBox(e);
  const el = e.target.closest('[data-in]');
  if (el && el.tagName !== 'SELECT' && INPUT[el.dataset.in]) INPUT[el.dataset.in](el, e);
});
// ショートカットから戻ってきたら、取り込みボタンを大きく出す（コピー内容を読むにはタップが必要なため）
// 入力欄をタップしたら：入っている数字を全部選ぶ（そのまま打てば置き換わる）＋キーボードが出たあと入力欄を画面の真ん中へ
const centerFocused = () => {
  const el = document.activeElement;
  if (el?.matches('input, textarea') && el.closest('.sheet-panel')) el.scrollIntoView({ block: 'center' });
};
document.addEventListener('focusin', e => {
  const el = e.target;
  if (!el.matches?.('input, textarea') || !el.closest('.sheet-panel')) return;
  if (el.classList.contains('set-in')) setTimeout(() => el.select(), 0);
  setTimeout(centerFocused, 350);
});
// キーボードが出たら、下から出る画面をキーボードの上の見えている部分に収める（上が切れないように）
if (window.visualViewport) {
  const fit = () => {
    const v = visualViewport, r = document.documentElement.style;
    r.setProperty('--vvh', `${v.height}px`);
    r.setProperty('--vvt', `${v.offsetTop}px`);
  };
  visualViewport.addEventListener('resize', () => { fit(); setTimeout(centerFocused, 50); });
  visualViewport.addEventListener('scroll', fit);
  fit();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  let t = 0;
  try { t = +localStorage.getItem('bodymake-hk-pending') || 0; localStorage.removeItem('bodymake-hk-pending'); } catch {}
  if (t && Date.now() - t < 10 * 60 * 1000) {
    openSheet('Apple Watchの記録を取り込む', `<p class="small">ショートカットでコピーした記録を取り込みます。</p>
      <button class="btn primary block" data-act="healthPasteClose" style="min-height:56px;font-size:17px">⌚ 取り込む</button>`);
  }
});
document.addEventListener('change', e => {
  syncDateBox(e);
  const el = e.target;
  if (el.matches('select[data-in], input[type=checkbox][data-in]') && INPUT[el.dataset.in]) INPUT[el.dataset.in](el, e);
  if (el.matches('[data-set], [data-eq], [data-target]')) onSettingChange(el);
});

(async () => {
  try { await navigator.storage?.persist?.(); } catch {}
  await loadAll();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // 新しい版に切り替わったら、自動で開き直す（初回は除く）
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
})();
