/* 教学助手 · 轻量版 — 纯前端逻辑
   设计原则：
   · 不建立学生档案；姓名/年级/课题都是临时字段，缺省就用“同学 / 本次测试”，AI 不编造。
   · 不上传文件到本站；试卷图片只在浏览器里压缩后直连 AI 官方接口（或团队代理）。
   · 直接 Key 模式：Key 只存本浏览器 localStorage；代理模式：浏览器只拿访问口令。
   · Word 导出在浏览器本地生成，不经过任何后端。
*/

const LS_KEY = 'taLite.v1';
const APP_VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);
const qs = (sel, root) => (root || document).querySelector(sel);
const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (d == null ? 0 : d);
}
function pct(n) {
  if (!Number.isFinite(n)) return '—';
  return (Math.round(n * 1000) / 10) + '%';
}
function debounce(fn, ms) {
  let t = null;
  return function () {
    const args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, args), ms || 200);
  };
}

/* ══════════════ 数据 ══════════════ */
const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-after',
    name: '课后反馈（进步 + 问题 + 下一步）',
    body: '{学生}家长您好，今天这节课我们重点学了{课题}。\n\n课上表现：{表现}\n\n需要加强：{问题}\n\n下一步安排：{下一步}\n\n如果您方便，也可以在家这样配合：{家长诉求}\n\n有不清楚的地方随时联系我。{老师}',
  },
  {
    id: 'tpl-stage',
    name: '阶段总结（一段时间的进步与规划）',
    body: '{学生}家长您好，这一阶段我们主要围绕{课题}做了练习和梳理。\n\n这段时间的进步：{表现}\n\n目前还存在的问题：{问题}\n\n下一阶段的安排：{下一步}\n\n想和您确认的是：{家长诉求}\n\n{老师}',
  },
  {
    id: 'tpl-trial',
    name: '试听课后转化（体验 + 诊断 + 建议）',
    body: '{学生}家长您好，感谢今天来试听。今天这节课我们体验了{课题}。\n\n孩子的课堂表现：{表现}\n\n从这节课看，目前比较需要补的是：{问题}\n\n如果接下来系统学，我的建议是：{下一步}\n\n您最关心的是：{家长诉求}\n\n{老师}',
  },
  {
    id: 'tpl-parent',
    name: '家长沟通（问题说明 + 配合方式）',
    body: '{学生}家长您好，想和您沟通一下{课题}的学习情况。\n\n最近的表现：{表现}\n\n需要一起关注的地方：{问题}\n\n我这边会做的调整：{下一步}\n\n也希望您在家配合：{家长诉求}\n\n{老师}',
  },
  {
    id: 'tpl-renew',
    name: '续费 / 长期规划',
    body: '{学生}家长您好，简单和您同步一下接下来的学习规划。\n\n目前基础：{表现}\n\n接下来重点：{问题}\n\n阶段目标与安排：{下一步}\n\n您这边的想法：{家长诉求}\n\n{老师}',
  },
];

const DEFAULT_SETTINGS = {
  mode: 'direct',
  provider: 'deepseek',
  model: 'deepseek-flash',
  visionModel: 'deepseek-flash',
  apiKey: '',
  proxyUrl: '',
  proxyToken: '',
  proxyProvider: 'deepseek',
  teacher: '',
};

function defaultState() {
  return {
    version: APP_VERSION,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    templates: BUILTIN_TEMPLATES.map((t) => Object.assign({}, t)),
    drafts: [],
    lastTab: 'exam',
    exam: { student: '', grade: '', name: '', date: today(), full: '', subject: '数学', questions: [], analysis: '' },
    lesson: { kind: 'new', stage: '小学', grade: '', subject: '数学', book: '', topic: '', duration: '', student: '', situation: '', extra: '', out: '' },
    feedback: { templateId: 'tpl-after', student: '', topic: '', good: '', bad: '', next: '', ask: '', out: '' },
  };
}

let state = defaultState();
let saveTimer = null;
function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const copy = JSON.parse(JSON.stringify(state));
      // 不持久化正在识别的图片；试卷只存结果
      localStorage.setItem(LS_KEY, JSON.stringify(copy));
    } catch (e) {
      console.warn('保存失败', e);
    }
  }, 250);
}
function syncStateNow() {
  state.exam.student = $('exStudent').value.trim();
  state.exam.grade = $('exGrade').value.trim();
  state.exam.name = $('exName').value.trim();
  state.exam.date = $('exDate').value || today();
  state.exam.full = $('exFull').value.trim();
  state.exam.subject = $('exSubject').value.trim();
  state.exam.analysis = $('examAnalysis').value;
  state.lesson = Object.assign(lessonFields(), { out: $('lessonOut').value });
  state.feedback = Object.assign({}, state.feedback, {
    student: $('fbStudent').value.trim(),
    topic: $('fbTopic').value.trim(),
    good: $('fbGood').value.trim(),
    bad: $('fbBad').value.trim(),
    next: $('fbNext').value.trim(),
    ask: $('fbAsk').value.trim(),
    out: $('fbOut').value,
  });
  saveState();
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return;
    state = Object.assign(defaultState(), j);
    state.settings = Object.assign({}, DEFAULT_SETTINGS, j.settings || {});
    if (!Array.isArray(state.templates) || !state.templates.length) state.templates = BUILTIN_TEMPLATES.map((t) => Object.assign({}, t));
    if (!Array.isArray(state.drafts)) state.drafts = [];
    state.exam.questions = Array.isArray(state.exam.questions) ? state.exam.questions : [];
  } catch (e) { console.warn('读取本地数据失败', e); }
}

/* ══════════════ UI 基础 ══════════════ */
function toast(msg, kind, ms) {
  const box = $('toasts');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'toast' + (kind ? ' ' + kind : '');
  d.textContent = String(msg == null ? '' : msg);
  box.appendChild(d);
  setTimeout(() => { try { d.remove(); } catch (_) {} }, ms || 3600);
}
let overlayAbort = null;
function showOverlay(title, text, cancelable) {
  $('ovTitle').textContent = title || '处理中…';
  $('ovText').textContent = text || '';
  $('ovCancel').hidden = !cancelable;
  $('overlay').hidden = false;
}
function setOverlayText(text) { $('ovText').textContent = text || ''; }
function hideOverlay() { $('overlay').hidden = true; overlayAbort = null; $('ovCancel').hidden = true; }

function switchTab(name) {
  qsa('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  qsa('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  state.lastTab = name;
  saveState();
  if (name === 'settings') fillSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setPreview(kind, mode) {
  const isMd = mode === 'md';
  const pairs = {
    exam: [$('examAnalysis'), $('examPreview')],
    lesson: [$('lessonOut'), $('lessonPreview')],
    fb: [$('fbOut'), $('fbPreview')],
  };
  const pair = pairs[kind];
  if (!pair) return;
  pair[0].hidden = !isMd;
  pair[1].hidden = isMd;
  qsa('[data-preview="' + kind + '"]').forEach((b) => {
    const label = b.textContent.trim();
    b.classList.toggle('active', isMd ? (label === '原文' || label === 'Markdown') : (label === '排版'));
  });
  if (!isMd) renderPreview(kind);
}
function renderPreview(kind) {
  if (kind === 'exam') {
    const md = $('examAnalysis').value.trim();
    $('examPreview').innerHTML = md ? window.TAMD.render(md) : '<span class="muted">分析内容会在这里排版显示</span>';
    $('examPreview').classList.toggle('empty', !md);
  } else if (kind === 'lesson') {
    const md = $('lessonOut').value.trim();
    $('lessonPreview').innerHTML = md ? window.TAMD.render(md) : '<span class="muted">教案预览</span>';
    $('lessonPreview').classList.toggle('empty', !md);
  } else if (kind === 'fb') {
    const md = $('fbOut').value.trim();
    $('fbPreview').innerHTML = md ? window.TAMD.render(md) : '<span class="muted">预览</span>';
    $('fbPreview').classList.toggle('empty', !md);
  }
}

/* ══════════════ AI ══════════════ */
function aiConfigured() {
  const s = state.settings;
  if (s.mode === 'proxy') return !!(s.proxyUrl && s.proxyToken);
  return !!(s.apiKey && s.provider);
}
function updateAiStatus() {
  const el = $('aiStatus');
  if (!el) return;
  const s = state.settings;
  if (aiConfigured()) {
    el.className = 'ai-status ok';
    el.textContent = s.mode === 'proxy' ? '团队代理 · 已配置' : (s.provider === 'glm' ? 'GLM · 已配置' : 'DeepSeek · 已配置');
  } else {
    el.className = 'ai-status bad';
    el.textContent = '未配置 AI';
  }
  const st = $('cfgState');
  if (st) st.textContent = aiConfigured() ? '已配置' : '未配置';
}
function providerBase() {
  const s = state.settings;
  if (s.mode === 'proxy') return (s.proxyUrl || '').replace(/\/+$/, '') + '/v1/chat';
  return s.provider === 'glm'
    ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
    : 'https://api.deepseek.com/chat/completions';
}
function apiError(j, status) {
  const e = j && (j.error || j.message || (j.error && j.error.message));
  const msg = typeof e === 'string' ? e : (e && e.message) || '';
  if (status === 401) return '密钥无效或未授权（401）。请到设置里检查 Key / 访问口令。';
  if (status === 402) return '账户余额不足（402）。请到供应商控制台充值。';
  if (status === 429) return '请求太频繁或额度受限（429），稍后再试。';
  if (status === 403) return '没有权限（403）。可能 Key 没有该模型权限。';
  if (status >= 500) return 'AI 服务暂时不可用（' + status + '），稍后再试。';
  return msg ? ('AI 请求失败：' + msg) : ('AI 请求失败（HTTP ' + status + '）');
}
async function fetchTimeout(url, opts, ms, outerSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('超时', 'TimeoutError')), ms || 180000);
  let onAbort = null;
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else {
      onAbort = () => ctrl.abort();
      outerSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
    if (onAbort) outerSignal.removeEventListener('abort', onAbort);
  }
}
function contentOf(j) {
  const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).join('');
  return '';
}
async function callAI(opts) {
  const o = opts || {};
  const s = state.settings;
  if (!aiConfigured()) throw new Error('还没有配置 AI。请先到「设置」里填写 Key 或团队代理。');
  const model = o.model || (o.vision ? s.visionModel || s.model : s.model) || 'deepseek-flash';
  const body = {
    model: model,
    messages: o.messages || [],
    temperature: o.temperature == null ? 0.3 : o.temperature,
    max_tokens: o.maxTokens || 4096,
    stream: false,
  };
  let url, headers;
  if (s.mode === 'proxy') {
    url = providerBase();
    headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.proxyToken };
    body.provider = s.proxyProvider || 'deepseek';
    body.model = model;
  } else {
    url = providerBase();
    headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey };
  }
  let res;
  try {
    res = await fetchTimeout(url, { method: 'POST', headers: headers, body: JSON.stringify(body) }, o.timeout || 180000, o.signal);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    if (e && e.name === 'TimeoutError') throw new Error('AI 请求超时（' + Math.round((o.timeout || 180000) / 1000) + ' 秒），请稍后重试。');
    throw new Error('网络请求失败：' + (e && e.message || e) + '。如果是 GLM/浏览器跨域问题，建议改用团队代理模式。');
  }
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) throw new Error(apiError(j, res.status));
  const content = contentOf(j);
  if (!content) {
    const fr = j && j.choices && j.choices[0] && j.choices[0].finish_reason;
    if (fr === 'length') throw new Error('AI 输出被截断（max_tokens 用尽）。请缩短输入或换更强的模型后重试。');
    throw new Error('AI 返回为空。请检查模型名是否可用（当前：' + model + '）。');
  }
  return content;
}

function parseJsonLoose(text) {
  let s = String(text == null ? '' : text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((x) => x >= 0);
  if (!starts.length) return null;
  const start = Math.min.apply(null, starts);
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}
async function callJSON(opts) {
  const base = Object.assign({}, opts);
  const first = await callAI(base);
  let j = parseJsonLoose(first);
  if (j) return j;
  const retryMessages = (base.messages || []).concat([
    { role: 'user', content: '上一次输出不是合法 JSON。请只输出 JSON，不要 Markdown 代码围栏，不要解释。' },
  ]);
  const second = await callAI(Object.assign({}, base, { messages: retryMessages, temperature: 0.1 }));
  j = parseJsonLoose(second);
  if (!j) throw new Error('AI 返回的内容不是可解析的 JSON。可以重试，或换更强的模型。');
  return j;
}

/* ══════════════ 试卷 ══════════════ */
let examFiles = []; // {name, dataUrl, kind, pages}
function examQuestionTemplate(i) {
  return {
    no: String(i + 1),
    stem: '',
    answer: '',
    studentAnswer: '',
    correct: null,
    score: null,
    maxScore: null,
    knowledge: '',
    errorType: '',
    analysis: '',
  };
}
function normalizeQuestion(q, idx) {
  const src = q && typeof q === 'object' ? q : {};
  const correctRaw = src.correct;
  let correct = null;
  if (correctRaw === true || correctRaw === 'true' || correctRaw === 1 || correctRaw === '1' || correctRaw === '对' || correctRaw === '正确') correct = true;
  else if (correctRaw === false || correctRaw === 'false' || correctRaw === 0 || correctRaw === '0' || correctRaw === '错' || correctRaw === '错误') correct = false;
  const errorTypes = ['概念不清', '计算错误', '审题错误', '步骤缺失', '单位错误', '方法不会', '其他'];
  let et = String(src.errorType || src.error || '').trim();
  if (et && errorTypes.indexOf(et) < 0) {
    const hit = errorTypes.find((x) => et.indexOf(x) >= 0);
    et = hit || et;
  }
  return {
    no: String(src.no != null ? src.no : (idx + 1)),
    stem: String(src.stem || src.question || src.text || '').trim(),
    answer: String(src.answer || src.correctAnswer || '').trim(),
    studentAnswer: String(src.studentAnswer || src.student_answer || src.answerStudent || '').trim(),
    correct: correct,
    score: src.score != null && src.score !== '' && Number.isFinite(Number(src.score)) ? Number(src.score) : null,
    maxScore: src.maxScore != null && src.maxScore !== '' && Number.isFinite(Number(src.maxScore)) ? Number(src.maxScore) : null,
    knowledge: String(src.knowledge || src.knowledgePoint || src.topic || '').trim(),
    errorType: et,
    analysis: String(src.analysis || src.explain || '').trim(),
  };
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('读取文件失败：' + file.name));
    r.readAsDataURL(file);
  });
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}
async function normalizeImage(file) {
  const raw = await readFileAsDataURL(file);
  const img = await loadImage(raw);
  const max = 1600;
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (w > max || h > max) {
    const r = Math.min(max / w, max / h);
    w = Math.round(w * r); h = Math.round(h * r);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.86);
}
async function pdfToImages(file, onProgress) {
  const pdfjs = await import('./vendor/pdfjs/pdf.min.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const n = Math.min(doc.numPages, 10);
  const out = [];
  for (let p = 1; p <= n; p++) {
    if (onProgress) onProgress(p, n);
    const page = await doc.getPage(p);
    let vp = page.getViewport({ scale: 2 });
    const maxW = 1600;
    if (vp.width > maxW) vp = page.getViewport({ scale: 2 * maxW / vp.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(canvas.toDataURL('image/jpeg', 0.86));
  }
  return out;
}

async function addExamFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  for (const f of list) {
    if (examFiles.length >= 10) { toast('最多 10 页，已忽略剩余文件', 'bad'); break; }
    if (!/^image\//.test(f.type) && f.type !== 'application/pdf') { toast('只支持图片或 PDF：' + f.name, 'bad'); continue; }
    try {
      if (f.type === 'application/pdf') {
        showOverlay('读取 PDF…', '正在把 PDF 页面转成图片');
        const pages = await pdfToImages(f, (p, n) => setOverlayText('第 ' + p + '/' + n + ' 页'));
        pages.forEach((dataUrl, i) => {
          if (examFiles.length < 10) examFiles.push({ name: f.name + (pages.length > 1 ? ' 第' + (i + 1) + '页' : ''), dataUrl, kind: 'page' });
        });
        hideOverlay();
      } else {
        const dataUrl = await normalizeImage(f);
        examFiles.push({ name: f.name, dataUrl, kind: 'image' });
      }
    } catch (e) {
      hideOverlay();
      toast('处理失败：' + (e && e.message || e), 'bad', 5000);
    }
  }
  renderExamFiles();
  updateExamButtons();
}
function renderExamFiles() {
  const wrap = $('examFiles');
  wrap.innerHTML = '';
  examFiles.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'file-item';
    d.innerHTML = '<img alt="" src="' + f.dataUrl + '"><div class="fi-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
      '<div class="fi-meta">' + (f.kind === 'page' ? 'PDF 页' : '图片') + '</div>' +
      '<button class="fi-x" type="button" data-i="' + i + '" title="移除">×</button>';
    wrap.appendChild(d);
  });
  qsa('.fi-x', wrap).forEach((b) => {
    b.onclick = () => { examFiles.splice(Number(b.dataset.i), 1); renderExamFiles(); updateExamButtons(); };
  });
}
function updateExamButtons() {
  const has = examFiles.length > 0;
  $('btnExamExtract').disabled = !has || !aiConfigured();
  $('examExtractHint').textContent = !has ? '先添加试卷，再点识别' : (!aiConfigured() ? '还没配置 AI，去「设置」填 Key 或代理' : '将逐页发送给识图模型，请确认试卷无隐私信息');
}

const EXAM_PROMPT = [
  '你是老师的试卷录入助手。请从这张试卷/答题图片中逐题提取信息，只返回 JSON，不要解释、不要 Markdown 代码围栏。',
  'JSON 结构：',
  '{"examName":"","studentName":"","grade":"","totalScore":null,"questions":[{"no":"1","stem":"","answer":"","studentAnswer":"","correct":true或false或null,"score":null,"maxScore":null,"knowledge":"","errorType":"","analysis":""}]}',
  '规则：',
  '1. 看不清、图片里没有的字段用 "" 或 null，绝对不要编造。',
  '2. correct 只在能看清学生作答时判断；没有学生作答就填 null。',
  '3. score 是学生得分，maxScore 是本题满分；没有标注就填 null。',
  '4. 题干保留公式，可用 $...$。',
  '5. errorType 从「概念不清/计算错误/审题错误/步骤缺失/单位错误/方法不会/其他」里选一个；判断不了就填 ""。',
  '6. 如果一张图里有多道题，全部列出；题号按图片上的题号。',
].join('\n');

async function extractExam() {
  if (!examFiles.length) return toast('先添加试卷图片或 PDF', 'bad');
  if (!aiConfigured()) return toast('还没有配置 AI，请先到设置里配置', 'bad');
  const ctrl = new AbortController();
  overlayAbort = ctrl;
  const all = [];
  const errors = [];
  showOverlay('识别试卷中…', '准备中', true);
  $('btnExamStop').hidden = false;
  state.exam.questions = [];
  renderExamTable();
  try {
    for (let i = 0; i < examFiles.length; i++) {
      if (ctrl.signal.aborted) break;
      setOverlayText('第 ' + (i + 1) + '/' + examFiles.length + ' 页：' + examFiles[i].name);
      try {
        const messages = [
          { role: 'system', content: '你是严谨的试卷识别助手，只输出 JSON。' },
          { role: 'user', content: [
            { type: 'text', text: EXAM_PROMPT },
            { type: 'image_url', image_url: { url: examFiles[i].dataUrl } },
          ] },
        ];
        const j = await callJSON({
          messages: messages,
          model: state.settings.visionModel || state.settings.model,
          vision: true,
          maxTokens: 8192,
          temperature: 0.1,
          timeout: 180000,
          signal: ctrl.signal,
        });
        if (!j || !Array.isArray(j.questions)) throw new Error('模型没有返回 questions 数组');
        j.questions.forEach((q) => all.push(normalizeQuestion(q, all.length)));
        if (!$('exStudent').value && j.studentName) $('exStudent').value = String(j.studentName);
        if (!$('exGrade').value && j.grade) $('exGrade').value = String(j.grade);
        if (!$('exName').value && j.examName) $('exName').value = String(j.examName);
        if (!$('exFull').value && j.totalScore != null && Number.isFinite(Number(j.totalScore))) $('exFull').value = String(j.totalScore);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        errors.push('第 ' + (i + 1) + ' 页：' + (e && e.message || e));
      }
    }
    state.exam.questions = all.map((q, i) => Object.assign(q, { no: String(i + 1) }));
    $('examAnalysis').value = '';
    state.exam.analysis = '';
    syncExamMeta();
    renderExamTable();
    updateExamStats();
    updateExamButtons();
    renderPreview('exam');
    setPreview('exam', 'md');
    $('btnExamAnalyze').disabled = !state.exam.questions.length;
    if (errors.length) toast('部分页面识别失败：' + errors[0] + (errors.length > 1 ? (' 等 ' + errors.length + ' 页') : ''), 'bad', 6000);
    else if (!all.length) toast('没有识别出题目。换更清晰的照片，或检查模型是否支持图片。', 'bad', 6000);
    else toast('识别完成，共 ' + all.length + ' 题。请核对表格后再分析。', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') toast('已停止识别', '', 2500);
    else toast('识别失败：' + (e && e.message || e), 'bad', 6000);
  } finally {
    hideOverlay();
    $('btnExamStop').hidden = true;
    overlayAbort = null;
  }
}

function syncExamMeta() {
  state.exam.student = $('exStudent').value.trim();
  state.exam.grade = $('exGrade').value.trim();
  state.exam.name = $('exName').value.trim();
  state.exam.date = $('exDate').value || today();
  state.exam.full = $('exFull').value.trim();
  state.exam.subject = $('exSubject').value.trim() || '数学';
  saveState();
}
function examStats() {
  const qs = state.exam.questions || [];
  const n = qs.length;
  let correct = 0, wrong = 0, unknown = 0, score = 0, max = 0;
  const errCount = {}, kCount = {};
  qs.forEach((q) => {
    if (q.correct === true) correct++;
    else if (q.correct === false) wrong++;
    else unknown++;
    score += num(q.score, 0);
    max += num(q.maxScore, 0);
    if (q.errorType) errCount[q.errorType] = (errCount[q.errorType] || 0) + 1;
    if (q.knowledge) kCount[q.knowledge] = (kCount[q.knowledge] || 0) + 1;
  });
  const inputFull = num(state.exam.full, 0);
  const full = max > 0 ? max : inputFull;
  const rate = full > 0 ? score / full : (n ? correct / n : 0);
  return { n, correct, wrong, unknown, score, max, full, inputFull, rate, errCount, kCount };
}
function renderExamStats() {
  const box = $('examStats');
  const st = examStats();
  if (!st.n) { box.className = 'stats empty'; box.textContent = '识别后这里显示得分与错题统计'; return; }
  box.className = 'stats';
  const full = st.full || st.max;
  const rate = st.full > 0 ? st.score / st.full : (st.n ? st.correct / st.n : 0);
  const items = [
    ['题数', st.n, ''],
    ['正确', st.correct, 'good'],
    ['错误', st.wrong, st.wrong ? 'bad' : ''],
    ['未判定', st.unknown, ''],
    ['得分', full ? (st.score + '/' + full) : st.score, 'warn'],
    ['得分率', pct(rate), rate >= 0.85 ? 'good' : (rate < 0.6 ? 'bad' : 'warn')],
  ];
  box.innerHTML = items.map(([k, v, cls]) => '<div class="stat ' + cls + '"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>').join('');
}
function updateExamStats() { renderExamStats(); }

function renderExamTable() {
  const wrap = $('examTableWrap');
  const qs = state.exam.questions || [];
  if (!qs.length) {
    wrap.className = 'table-wrap empty-state';
    wrap.innerHTML = '<div class="empty-ico">▤</div><p>识别后，每道题会出现在这里；所有格子都可以直接改。</p>';
    return;
  }
  wrap.className = 'table-wrap';
  const errTypes = ['', '概念不清', '计算错误', '审题错误', '步骤缺失', '单位错误', '方法不会', '其他'];
  let html = '<table class="q-table"><thead><tr>' +
    ['题号', '题干', '学生作答', '答案', '对错', '得分', '满分', '知识点', '错因', '解析', ''].map((h) => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>';
  qs.forEach((q, i) => {
    const cls = q.correct === false ? ' class="q-wrong"' : '';
    html += '<tr data-i="' + i + '"' + cls + '>' +
      '<td class="small-col"><input data-f="no" value="' + esc(q.no) + '"></td>' +
      '<td><textarea data-f="stem" rows="2">' + esc(q.stem) + '</textarea></td>' +
      '<td><textarea data-f="studentAnswer" rows="2">' + esc(q.studentAnswer) + '</textarea></td>' +
      '<td><textarea data-f="answer" rows="2">' + esc(q.answer) + '</textarea></td>' +
      '<td class="small-col"><select data-f="correct">' +
      '<option value=""' + (q.correct == null ? ' selected' : '') + '>—</option>' +
      '<option value="true"' + (q.correct === true ? ' selected' : '') + '>对</option>' +
      '<option value="false"' + (q.correct === false ? ' selected' : '') + '>错</option>' +
      '</select></td>' +
      '<td class="score"><input data-f="score" type="number" step="0.5" value="' + (q.score == null ? '' : q.score) + '"></td>' +
      '<td class="score"><input data-f="maxScore" type="number" step="0.5" value="' + (q.maxScore == null ? '' : q.maxScore) + '"></td>' +
      '<td><textarea data-f="knowledge" rows="1">' + esc(q.knowledge) + '</textarea></td>' +
      '<td><select data-f="errorType">' + errTypes.map((x) => '<option value="' + esc(x) + '"' + (q.errorType === x ? ' selected' : '') + '>' + (x || '—') + '</option>').join('') + '</select></td>' +
      '<td><textarea data-f="analysis" rows="2">' + esc(q.analysis) + '</textarea></td>' +
      '<td class="small-col"><button class="del-row" type="button" data-del="' + i + '" title="删除">×</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  wrap.oninput = (ev) => {
    const el = ev.target;
    const f = el && el.dataset && el.dataset.f;
    if (!f) return;
    const tr = el.closest('tr');
    const i = tr ? Number(tr.dataset.i) : -1;
    const q = state.exam.questions[i];
    if (!q) return;
    if (f === 'score' || f === 'maxScore') q[f] = el.value === '' ? null : num(el.value, 0);
    else if (f === 'correct') q.correct = el.value === 'true' ? true : el.value === 'false' ? false : null;
    else q[f] = el.value;
    if (f === 'correct') tr.classList.toggle('q-wrong', q.correct === false);
    saveState();
  };
  wrap.onchange = wrap.oninput;
  wrap.onclick = (ev) => {
    const b = ev.target.closest('[data-del]');
    if (!b) return;
    state.exam.questions.splice(Number(b.dataset.del), 1);
    renderExamTable();
    updateExamStats();
    saveState();
  };
}

function examPromptText() {
  const st = examStats();
  const meta = {
    student: $('exStudent').value.trim() || '同学',
    grade: $('exGrade').value.trim() || '未填写',
    exam: $('exName').value.trim() || '本次测试',
    date: $('exDate').value || today(),
    subject: $('exSubject').value.trim() || '数学',
    full: st.full || '未填写',
    inputFull: st.inputFull || '',
    score: st.score,
    max: st.max,
    correct: st.correct,
    wrong: st.wrong,
    unknown: st.unknown,
  };
  const rows = (state.exam.questions || []).map((q) => ({
    no: q.no, stem: q.stem, answer: q.answer, studentAnswer: q.studentAnswer,
    correct: q.correct, score: q.score, maxScore: q.maxScore,
    knowledge: q.knowledge, errorType: q.errorType, analysis: q.analysis,
  }));
  return '请根据下面的试卷逐题记录写一份试卷分析报告，用 Markdown，不要输出 JSON。\n\n' +
    '【本次信息】\n' + JSON.stringify(meta, null, 2) + '\n\n' +
    '【逐题记录】\n' + JSON.stringify(rows, null, 2) + '\n\n' +
    '要求：\n' +
    '1. 结构：## 总体判断 / ## 得分结构 / ## 错因归类 / ## 重点补漏 / ## 下节课建议 / ## 家长版三句话。\n' +
    '2. 只基于记录说话；没有数据的地方写“本次记录未体现”，不要编造分数、排名、班级情况。\n' +
    '3. 错因归类要具体到题号；至少指出 2 个可执行的补漏动作。\n' +
    '4. 家长版三句话要能直接发给家长，语气自然、不夸张、不承诺分数。\n' +
    '5. 不要提“AI”“模型”。';
}
function localExamAnalysis() {
  const st = examStats();
  const qs = state.exam.questions || [];
  const errs = Object.entries(st.errCount).sort((a, b) => b[1] - a[1]);
  const weak = Object.entries(st.kCount).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const rate = st.full > 0 ? st.score / st.full : (st.n ? st.correct / st.n : 0);
  const wrongNos = qs.filter((q) => q.correct === false).map((q) => q.no).join('、') || '本次未判定';
  const lines = [];
  lines.push('## 总体判断');
  lines.push('本次共 ' + st.n + ' 题，判定正确 ' + st.correct + ' 题、错误 ' + st.wrong + ' 题' + (st.unknown ? ('、未判定 ' + st.unknown + ' 题') : '') +
    '；卷面得分 ' + st.score + (st.full ? ('/' + st.full) : '') + '，得分率 ' + pct(rate) + '。');
  lines.push('## 得分结构');
  lines.push(st.full > 0 ? ('得分率 ' + pct(rate) + '，' + (rate >= 0.85 ? '整体掌握较好，重点在稳定和提速。' : rate >= 0.6 ? '基础题基本能拿分，中档题有明显失分。' : '基础题失分较多，需要先补概念和基本步骤。')) : '本次没有记录满分，得分结构以对错比例为准。');
  lines.push('## 错因归类');
  if (errs.length) errs.forEach(([k, v]) => lines.push('- ' + k + '：' + v + ' 题'));
  else lines.push('- 本次记录里没有填写错因；建议先给错题标注错因，再分析。');
  if (weak.length) lines.push('涉及知识点：' + weak.map(([k, v]) => k + '（' + v + ' 题）').join('；') + '。');
  lines.push('## 重点补漏');
  lines.push('- 错题题号：' + wrongNos + '。先让学生逐题复述“当时怎么想的”，再重做一遍。');
  lines.push('- 从错因最多的一类入手，做 3 道同型题 + 1 道变式，确认不是靠记忆。');
  lines.push('## 下节课建议');
  lines.push('- 前 10 分钟：错题回炉（原题 + 变式各 1 道）。');
  lines.push('- 中段：围绕薄弱知识点做“讲—练—纠”一轮。');
  lines.push('- 后 10 分钟：当堂检测 2 道，确认迁移。');
  lines.push('## 家长版三句话');
  lines.push('1. 本次练习整体' + (rate >= 0.85 ? '完成得不错' : rate >= 0.6 ? '基础题还可以，中档题有失分' : '基础部分失分偏多') + '。');
  lines.push('2. 目前最需要补的是' + (errs.length ? errs[0][0] : '错题背后的概念和步骤') + '，不是单纯多刷题。');
  lines.push('3. 下节课我会先带他/她把错题重新讲一遍，再做同型检测。');
  return lines.join('\n');
}
async function analyzeExam() {
  if (!state.exam.questions.length) return toast('先识别或手动添加题目', 'bad');
  syncExamMeta();
  if (!aiConfigured()) {
    $('examAnalysis').value = localExamAnalysis();
    renderPreview('exam');
    syncStateNow();
    toast('还没配置 AI，已用本地规则生成分析；配置后可让 AI 写得更细。', '', 5000);
    return;
  }
  showOverlay('分析试卷中…', '正在整理得分、错因和补漏建议', true);
  const ctrl = new AbortController(); overlayAbort = ctrl;
  try {
    const text = await callAI({
      messages: [
        { role: 'system', content: '你是资深数学教研老师，擅长把试卷数据写成可执行的分析报告。' },
        { role: 'user', content: examPromptText() },
      ],
      model: state.settings.model,
      maxTokens: 8192,
      temperature: 0.35,
      timeout: 180000,
      signal: ctrl.signal,
    });
    $('examAnalysis').value = text.trim();
    renderPreview('exam');
    setPreview('exam', 'html');
    syncStateNow();
    toast('分析完成，可逐段修改后导出', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') toast('已停止', '', 2500);
    else toast('分析失败：' + (e && e.message || e), 'bad', 6000);
  } finally { hideOverlay(); }
}

function examBlocks() {
  const st = examStats();
  const student = $('exStudent').value.trim() || '同学';
  const examName = $('exName').value.trim() || '本次测试';
  const date = $('exDate').value || today();
  const full = st.full || '';
  const analysis = $('examAnalysis').value.trim();
  const rate = st.full > 0 ? st.score / st.full : (st.n ? st.correct / st.n : 0);
  const blocks = [];
  blocks.push({ type: 'title', text: '试卷分析报告' });
  blocks.push({ type: 'subtitle', text: student + ' · ' + examName });
  blocks.push({ type: 'meta', text: '年级：' + ($('exGrade').value.trim() || '未填写') + '　｜　科目：' + ($('exSubject').value.trim() || '数学') + '　｜　日期：' + date });
  blocks.push({ type: 'meta', text: '得分：' + st.score + (full ? (' / ' + full) : '') + '　｜　判定：正确 ' + st.correct + ' · 错误 ' + st.wrong + (st.unknown ? (' · 未判定 ' + st.unknown) : '') + '　｜　得分率：' + pct(rate) });
  if (st.inputFull && st.max && st.inputFull !== st.max) {
    blocks.push({ type: 'note', text: '说明：填写的满分为 ' + st.inputFull + '，题目满分合计为 ' + st.max + '；本报告按题目满分合计计算。' });
  }
  blocks.push({ type: 'hr' });
  blocks.push({ type: 'h2', text: '一、数据概览' });
  blocks.push({
    type: 'table',
    rows: [
      ['题数', '正确', '错误', '未判定', '得分', '满分', '得分率'],
      [String(st.n), String(st.correct), String(st.wrong), String(st.unknown), String(st.score), full || String(st.max), pct(rate)],
    ],
    widths: [1200, 1100, 1100, 1200, 1100, 1100, 1200],
  });
  blocks.push({ type: 'h2', text: '二、逐题记录' });
  const rows = [['题号', '题干', '答案', '学生作答', '判定', '得分', '知识点', '错因']];
  (state.exam.questions || []).forEach((q) => {
    rows.push([
      q.no || '',
      q.stem || '',
      q.answer || '',
      q.studentAnswer || '',
      q.correct === true ? '对' : q.correct === false ? '错' : '—',
      (q.score == null ? '' : q.score) + (q.maxScore == null ? '' : ('/' + q.maxScore)),
      q.knowledge || '',
      q.errorType || '',
    ]);
  });
  blocks.push({ type: 'table', rows: rows, widths: [700, 2600, 1400, 1400, 700, 800, 1200, 1000] });
  blocks.push({ type: 'h2', text: '三、分析报告' });
  if (analysis) blocks.push.apply(blocks, window.TADocx.markdownToBlocks(analysis));
  else blocks.push({ type: 'p', text: '（还没有填写分析）' });
  blocks.push({ type: 'hr' });
  blocks.push({ type: 'note', text: '生成时间：' + new Date().toLocaleString('zh-CN') + '　·　教学助手 · 轻量版' });
  return { blocks, student, examName, date };
}
async function exportExamDocx() {
  syncExamMeta();
  const { blocks, student, examName, date } = examBlocks();
  if (!state.exam.questions.length) return toast('没有题目可导出', 'bad');
  try {
    const blob = await window.TADocx.build({ blocks: blocks });
    window.TADocx.download('试卷分析_' + window.TADocx.safeName(student) + '_' + window.TADocx.safeName(examName) + '_' + date + '.docx', blob);
    toast('已导出试卷分析报告', 'ok');
  } catch (e) { toast('导出失败：' + (e && e.message || e), 'bad', 5000); }
}
async function exportErrDocx() {
  syncExamMeta();
  const wrong = (state.exam.questions || []).filter((q) => q.correct === false);
  if (!wrong.length) return toast('没有判定为“错”的题；先把对错标出来再导出', 'bad', 4500);
  const student = $('exStudent').value.trim() || '同学';
  const blocks = [
    { type: 'title', text: '错题清单' },
    { type: 'subtitle', text: student + ' · ' + ($('exName').value.trim() || '本次测试') },
    { type: 'meta', text: '日期：' + ($('exDate').value || today()) + '　·　共 ' + wrong.length + ' 道错题' },
    { type: 'hr' },
  ];
  wrong.forEach((q, i) => {
    blocks.push({ type: 'h3', text: '第 ' + (q.no || (i + 1)) + ' 题' + (q.knowledge ? ('　·　' + q.knowledge) : '') });
    if (q.stem) blocks.push({ type: 'p', text: '题干：' + q.stem });
    if (q.studentAnswer) blocks.push({ type: 'p', text: '学生作答：' + q.studentAnswer });
    if (q.answer) blocks.push({ type: 'p', text: '正确答案：' + q.answer });
    if (q.errorType) blocks.push({ type: 'p', text: '错因：' + q.errorType });
    if (q.analysis) blocks.push({ type: 'p', text: '解析：' + q.analysis });
    blocks.push({ type: 'p', text: '重做一次：____________________________________________' , before: 40 });
  });
  try {
    const blob = await window.TADocx.build({ blocks: blocks });
    window.TADocx.download('错题清单_' + window.TADocx.safeName(student) + '_' + ($('exDate').value || today()) + '.docx', blob);
    toast('已导出错题清单', 'ok');
  } catch (e) { toast('导出失败：' + (e && e.message || e), 'bad', 5000); }
}
function buildExamPrintHtml() {
  const st = examStats();
  const student = $('exStudent').value.trim() || '同学';
  const analysis = $('examAnalysis').value.trim();
  const rows = (state.exam.questions || []).map((q) => '<tr><td>' + esc(q.no) + '</td><td>' + esc(q.stem) + '</td><td>' + esc(q.answer) + '</td><td>' + esc(q.studentAnswer) + '</td><td>' + (q.correct === true ? '对' : q.correct === false ? '错' : '—') + '</td><td>' + esc(q.score == null ? '' : q.score) + (q.maxScore == null ? '' : '/' + esc(q.maxScore)) + '</td><td>' + esc(q.knowledge) + '</td><td>' + esc(q.errorType) + '</td></tr>').join('');
  return '<h1>试卷分析报告</h1><p class="sub">' + esc(student) + ' · ' + esc($('exName').value.trim() || '本次测试') + '</p>' +
    '<p class="meta">年级：' + esc($('exGrade').value.trim() || '未填写') + '　科目：' + esc($('exSubject').value.trim() || '数学') + '　日期：' + esc($('exDate').value || today()) + '</p>' +
    '<p class="meta">得分：' + st.score + (st.full ? '/' + st.full : '') + '　正确 ' + st.correct + ' · 错误 ' + st.wrong + ' · 未判定 ' + st.unknown + '</p>' +
    '<h2>逐题记录</h2><table><thead><tr><th>题号</th><th>题干</th><th>答案</th><th>学生作答</th><th>判定</th><th>得分</th><th>知识点</th><th>错因</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<h2>分析报告</h2>' + (analysis ? window.TAMD.render(analysis) : '<p>（未填写）</p>');
}

/* ══════════════ 成绩表分析 ══════════════ */
function parseScores(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s) return;
    const parts = s.split(/[,，\t;；]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    let score = null;
    for (let i = parts.length - 1; i >= 0; i--) {
      const n = Number(parts[i]);
      if (Number.isFinite(n)) { score = n; break; }
    }
    if (score == null) return;
    const name = parts.find((p) => !Number.isFinite(Number(p))) || ('学生' + (out.length + 1));
    out.push({ name: name, score: score });
  });
  return out;
}
function scoreStats(list, full) {
  const arr = list.map((x) => x.score).filter((n) => Number.isFinite(n));
  if (!arr.length) return null;
  const n = arr.length;
  const sum = arr.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const max = Math.max.apply(null, arr);
  const min = Math.min.apply(null, arr);
  const sorted = arr.slice().sort((a, b) => a - b);
  const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const pass = arr.filter((x) => x >= full * 0.6).length;
  const excellent = arr.filter((x) => x >= full * 0.9).length;
  const buckets = [[0, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]].map(([a, b]) => arr.filter((x) => x >= full * a && x < full * b).length);
  return { n, sum, avg, max, min, med, pass, excellent, buckets, full };
}
function renderScoreStats() {
  const list = parseScores($('scoreInput').value);
  const full = num($('scoreFull').value, 100) || 100;
  const st = scoreStats(list, full);
  const box = $('scoreStats');
  if (!st) { box.className = 'stats empty'; box.textContent = '粘贴分数后点“统计”'; return null; }
  box.className = 'stats';
  const items = [
    ['人数', st.n, ''], ['平均', Math.round(st.avg * 10) / 10, 'warn'], ['最高', st.max, 'good'], ['最低', st.min, st.min < full * 0.6 ? 'bad' : ''],
    ['中位', Math.round(st.med * 10) / 10, ''], ['及格率', pct(st.pass / st.n), st.pass / st.n >= 0.8 ? 'good' : 'warn'], ['优秀率', pct(st.excellent / st.n), 'good'],
  ];
  box.innerHTML = items.map(([k, v, cls]) => '<div class="stat ' + cls + '"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>').join('');
  return st;
}
function localScoreAnalysis(st, full) {
  const lines = [];
  lines.push('## 总体');
  lines.push('共 ' + st.n + ' 人，平均分 ' + (Math.round(st.avg * 10) / 10) + '/' + full + '，最高 ' + st.max + '，最低 ' + st.min + '，中位数 ' + (Math.round(st.med * 10) / 10) + '。');
  lines.push('## 分布');
  lines.push('及格率 ' + pct(st.pass / st.n) + '，优秀率 ' + pct(st.excellent / st.n) + '；分段：' +
    ['不及格', '60-69%', '70-79%', '80-89%', '90%+'].map((k, i) => k + ' ' + st.buckets[i] + ' 人').join('；') + '。');
  lines.push('## 教学建议');
  lines.push('- 先把不及格段落的学生名单拉出来，做一次错题面批。');
  lines.push('- 中段（60-79%）重点练“会而不对”，限时训练 + 检查步骤。');
  lines.push('- 高分段加变式和综合题，避免只刷熟题。');
  return lines.join('\n');
}
async function analyzeScores() {
  const st = renderScoreStats();
  if (!st) return toast('先粘贴分数', 'bad');
  const full = num($('scoreFull').value, 100) || 100;
  if (!aiConfigured()) {
    const local = localScoreAnalysis(st, full);
    $('scoreAnalysis').innerHTML = window.TAMD.render(local);
    $('scoreAnalysis').classList.remove('empty');
    $('scoreAnalysis').dataset.md = local;
    return toast('未配置 AI，已用本地统计生成建议', '', 4000);
  }
  showOverlay('分析成绩表…', '正在看分布和分数段', true);
  const ctrl = new AbortController(); overlayAbort = ctrl;
  try {
    const text = await callAI({
      messages: [
        { role: 'system', content: '你是数学教研老师，擅长从分数表里看出教学问题。' },
        { role: 'user', content: '请根据下面的成绩统计写一份简短分析，用 Markdown，不要 JSON。\n满分：' + full + '\n统计：' + JSON.stringify(st) + '\n要求：## 总体 / ## 分布 / ## 教学建议；只基于数据，不编造姓名和班级信息；建议要具体可执行。' },
      ],
      maxTokens: 4096,
      temperature: 0.35,
      signal: ctrl.signal,
    });
    $('scoreAnalysis').innerHTML = window.TAMD.render(text.trim());
    $('scoreAnalysis').classList.remove('empty');
    $('scoreAnalysis').dataset.md = text.trim();
    toast('分析完成', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') toast('已停止', '', 2000);
    else toast('分析失败：' + (e && e.message || e), 'bad', 5000);
  } finally { hideOverlay(); }
}
async function exportScoreDocx() {
  const st = renderScoreStats();
  if (!st) return toast('先粘贴分数', 'bad');
  const md = $('scoreAnalysis').dataset.md || window.TAMD.toText($('scoreAnalysis').innerText || '') || localScoreAnalysis(st, num($('scoreFull').value, 100) || 100);
  const blocks = [
    { type: 'title', text: '成绩表分析' },
    { type: 'meta', text: '满分：' + st.full + '　人数：' + st.n + '　平均：' + (Math.round(st.avg * 10) / 10) + '　及格率：' + pct(st.pass / st.n) + '　优秀率：' + pct(st.excellent / st.n) },
    { type: 'hr' },
    { type: 'h2', text: '分析' },
  ].concat(window.TADocx.markdownToBlocks(md));
  try {
    const blob = await window.TADocx.build({ blocks: blocks });
    window.TADocx.download('成绩表分析_' + today() + '.docx', blob);
    toast('已导出', 'ok');
  } catch (e) { toast('导出失败：' + (e && e.message || e), 'bad', 5000); }
}

/* ══════════════ 教案 ══════════════ */
let lessonKind = 'new';
function lessonFields() {
  return {
    kind: lessonKind,
    stage: $('lsStage').value,
    grade: $('lsGrade').value.trim(),
    subject: $('lsSubject').value.trim() || '数学',
    book: $('lsBook').value.trim(),
    topic: $('lsTopic').value.trim(),
    duration: $('lsDuration').value.trim(),
    student: $('lsStudent').value.trim(),
    situation: $('lsSituation').value.trim(),
    extra: $('lsExtra').value.trim(),
  };
}
function lessonPrompt(f) {
  const kindName = f.kind === 'trial' ? '试听课' : f.kind === 'review' ? '复习课' : '新授课';
  const structure = f.kind === 'trial'
    ? '## 课题信息\n## 学情探测（试听前 5 分钟要问什么、看什么）\n## 试听目标\n## 破冰与建立关系\n## 体验探究（含 1 道主例题 + 1 道变式）\n## 成果展示（让孩子讲出来）\n## 家长沟通要点（3 句话 + 1 个下一步）\n## 转化建议（适合/不适合、班型、频次）\n## 风险与备选'
    : f.kind === 'review'
      ? '## 课题信息\n## 学情分析\n## 复习目标\n## 知识结构梳理\n## 典型题精讲（2 道）\n## 变式与易错\n## 当堂检测\n## 作业分层\n## 板书设计\n## 课后反思'
      : '## 课题信息\n## 学情分析\n## 教学目标（知识 / 能力 / 素养）\n## 教学重难点\n## 教学准备\n## 教学过程（导入、探究、例题、练习、小结、作业；写清教师动作与学生动作）\n## 板书设计\n## 作业分层\n## 课后反思';
  return [
    '你是资深' + f.subject + '教研老师。请写一份可直接打印、可执行的' + f.stage + f.grade + '「' + (f.topic || '待定课题') + '」' + kindName + '教案。',
    '用 Markdown 输出，不要输出 JSON，不要解释你在做什么。',
    '【已知信息】',
    '学段：' + f.stage,
    '年级：' + (f.grade || '未填写'),
    '科目：' + f.subject,
    '教材版本：' + (f.book || '未填写'),
    '课题：' + (f.topic || '未填写'),
    '时长：' + (f.duration || '未填写'),
    '学生姓名（临时）：' + (f.student || '未填写'),
    '学生情况/家长诉求：' + (f.situation || '未填写'),
    '老师补充要求：' + (f.extra || '未填写'),
    '【硬性要求】',
    '1. 缺少的信息不要编造具体分数、排名、班级；用【待补】标出，或给通用做法。',
    '2. 每个环节写清：教师做什么、学生做什么、预计时间、如何判断达成。',
    '3. 至少 1 道主例题 + 1 道变式 + 1 道当堂检测；题目要符合该学段难度，不要只改数字。',
    '4. 语言具体、可执行，不要空话（“激发兴趣”“培养能力”这类必须落到动作）。',
    '5. 结构必须包含：\n' + structure,
    '6. 最后加一节「## 需要老师补充」列出 3~5 条还缺的信息。',
  ].join('\n');
}
function localLesson(f) {
  const kindName = f.kind === 'trial' ? '试听课' : f.kind === 'review' ? '复习课' : '新授课';
  const t = f.topic || '【待补课题】';
  return [
    '## 课题信息',
    '- 学段/年级：' + f.stage + ' ' + (f.grade || '【待补】'),
    '- 科目：' + f.subject + '　教材：' + (f.book || '【待补】'),
    '- 课题：' + t + '　课型：' + kindName + '　时长：' + (f.duration || '【待补】'),
    '- 学生：' + (f.student || '【待补】'),
    '',
    '## 学情分析',
    (f.situation || '【待补：学生当前基础、薄弱点、家长诉求】'),
    '',
    '## 教学目标',
    '1. 知识与技能：【待补】',
    '2. 过程与方法：【待补】',
    '3. 情感态度与素养：【待补】',
    '',
    '## 教学重难点',
    '- 重点：【待补】',
    '- 难点：【待补】',
    '',
    '## 教学准备',
    '- 教具/学案/练习：【待补】',
    '',
    '## 教学过程',
    '### 1. 导入（约 5 分钟）',
    '- 教师：【待补】',
    '- 学生：【待补】',
    '### 2. 探究（约 15 分钟）',
    '- 主例题：【待补】',
    '- 教师动作：【待补】',
    '- 学生动作：【待补】',
    '### 3. 例题与变式（约 15 分钟）',
    '- 例题：【待补】',
    '- 变式：【待补】',
    '### 4. 当堂检测（约 10 分钟）',
    '- 题目 1：【待补】',
    '- 题目 2：【待补】',
    '### 5. 小结与作业（约 5 分钟）',
    '- 小结：【待补】',
    '- 作业分层：【待补】',
    '',
    '## 板书设计',
    '【待补】',
    '',
    '## 作业分层',
    '- 基础：【待补】',
    '- 提升：【待补】',
    '- 挑战：【待补】',
    '',
    '## 课后反思',
    '【待补】',
    '',
    '## 需要老师补充',
    '1. 学生当前基础与最近一次测试情况',
    '2. 本节课要解决的最核心问题',
    '3. 可用教材/教参的页码范围',
    '4. 家长最关心的一点',
    '5. 课后可布置的作业量',
  ].join('\n');
}
async function generateLesson() {
  const f = lessonFields();
  if (!f.topic) return toast('先填课题', 'bad');
  if (!aiConfigured()) {
    $('lessonOut').value = localLesson(f);
    renderPreview('lesson');
    setPreview('lesson', 'md');
    syncStateNow();
    toast('未配置 AI，已生成可填写的本地模板；配置后 AI 会写完整版。', '', 5000);
    return;
  }
  showOverlay('生成教案中…', '正在按' + (f.kind === 'trial' ? '试听课' : '教案') + '结构写', true);
  const ctrl = new AbortController(); overlayAbort = ctrl;
  try {
    const text = await callAI({
      messages: [
        { role: 'system', content: '你是资深教研老师，写的教案要能直接拿去上课，不写空话。' },
        { role: 'user', content: lessonPrompt(f) },
      ],
      model: state.settings.model,
      maxTokens: 8192,
      temperature: 0.5,
      timeout: 240000,
      signal: ctrl.signal,
    });
    $('lessonOut').value = text.trim();
    renderPreview('lesson');
    setPreview('lesson', 'html');
    syncStateNow();
    toast('教案已生成，可逐段修改', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') toast('已停止', '', 2000);
    else toast('生成失败：' + (e && e.message || e), 'bad', 6000);
  } finally { hideOverlay(); }
}
function lessonMeta() {
  const f = lessonFields();
  return [
    '学段：' + f.stage + '　年级：' + (f.grade || '未填写') + '　科目：' + f.subject,
    '教材：' + (f.book || '未填写') + '　课时：' + (f.duration || '未填写') + '　学生：' + (f.student || '未填写'),
  ];
}
async function exportLessonDocx() {
  const md = $('lessonOut').value.trim();
  if (!md) return toast('还没有教案内容', 'bad');
  const f = lessonFields();
  try {
    const blob = await window.TADocx.fromMarkdown({
      title: (f.kind === 'trial' ? '试听课教案' : '教案') + ' · ' + (f.topic || '未命名'),
      subtitle: f.grade ? (f.stage + f.grade + ' · ' + f.subject) : f.subject,
      meta: lessonMeta(),
      md: md,
    });
    window.TADocx.download((f.kind === 'trial' ? '试听课教案_' : '教案_') + window.TADocx.safeName(f.topic || '未命名') + '_' + today() + '.docx', blob);
    toast('已导出教案', 'ok');
  } catch (e) { toast('导出失败：' + (e && e.message || e), 'bad', 5000); }
}
function lessonDraftTitle() {
  const f = lessonFields();
  return (f.kind === 'trial' ? '试听课 · ' : '') + (f.topic || '未命名') + (f.grade ? (' · ' + f.grade) : '');
}
function saveLessonDraft() {
  const f = lessonFields();
  const md = $('lessonOut').value.trim();
  if (!md) return toast('还没有内容可存', 'bad');
  const d = { id: 'd' + Date.now(), title: lessonDraftTitle(), kind: f.kind, at: new Date().toISOString(), fields: f, out: md };
  state.drafts.unshift(d);
  state.drafts = state.drafts.slice(0, 30);
  saveState();
  renderDrafts();
  toast('已存草稿', 'ok');
}
function renderDrafts() {
  const box = $('lessonDrafts');
  if (!state.drafts.length) { box.className = 'draft-list empty'; box.textContent = '还没有草稿'; return; }
  box.className = 'draft-list';
  box.innerHTML = state.drafts.map((d) => '<div class="draft-item" data-id="' + esc(d.id) + '"><div class="d-main"><div class="d-title">' + esc(d.title) + '</div><div class="d-meta">' + esc(new Date(d.at).toLocaleString('zh-CN')) + '</div></div><button class="btn small" data-load="' + esc(d.id) + '">载入</button><button class="btn ghost small danger-text" data-del="' + esc(d.id) + '">删除</button></div>').join('');
  box.onclick = (ev) => {
    const load = ev.target.closest('[data-load]');
    const del = ev.target.closest('[data-del]');
    if (load) {
      const d = state.drafts.find((x) => x.id === load.dataset.load);
      if (!d) return;
      lessonKind = d.kind || 'new';
      qsa('#lessonKindChips .chip').forEach((b) => b.classList.toggle('active', b.dataset.kind === lessonKind));
      Object.assign(state.lesson, { kind: d.kind || 'new' });
      $('lsStage').value = d.fields.stage || '小学';
      $('lsGrade').value = d.fields.grade || '';
      $('lsSubject').value = d.fields.subject || '数学';
      $('lsBook').value = d.fields.book || '';
      $('lsTopic').value = d.fields.topic || '';
      $('lsDuration').value = d.fields.duration || '';
      $('lsStudent').value = d.fields.student || '';
      $('lsSituation').value = d.fields.situation || '';
      $('lsExtra').value = d.fields.extra || '';
      $('lessonOut').value = d.out || '';
      renderPreview('lesson'); setPreview('lesson', 'md');
      syncStateNow();
      toast('已载入草稿', 'ok');
    } else if (del) {
      state.drafts = state.drafts.filter((x) => x.id !== del.dataset.del);
      saveState(); renderDrafts();
    }
  };
}

/* ══════════════ 反馈 ══════════════ */
function currentTemplate() {
  return state.templates.find((t) => t.id === state.feedback.templateId) || state.templates[0];
}
function renderTemplateList() {
  const box = $('fbTemplateList');
  box.innerHTML = state.templates.map((t) => '<div class="tpl-item' + (t.id === state.feedback.templateId ? ' active' : '') + '" data-id="' + esc(t.id) + '"><div class="tpl-name">' + esc(t.name) + '</div><span class="tpl-tag">模板</span></div>').join('');
  box.onclick = (ev) => {
    const item = ev.target.closest('[data-id]');
    if (!item) return;
    selectTemplate(item.dataset.id);
  };
}
function selectTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return;
  state.feedback.templateId = id;
  $('fbTemplateBody').value = t.body;
  renderTemplateList();
  saveState();
}
function fillTemplateText() {
  const tpl = $('fbTemplateBody').value;
  const map = {
    '{学生}': $('fbStudent').value.trim() || '同学',
    '{课题}': $('fbTopic').value.trim() || '本次课',
    '{表现}': $('fbGood').value.trim() || '【待补：具体进步】',
    '{问题}': $('fbBad').value.trim() || '【待补：需要加强的点】',
    '{下一步}': $('fbNext').value.trim() || '【待补：下一步安排】',
    '{家长诉求}': $('fbAsk').value.trim() || '【待补：家长关心/配合方式】',
    '{老师}': state.settings.teacher || '老师',
  };
  let out = tpl;
  Object.keys(map).forEach((k) => { out = out.split(k).join(map[k]); });
  return out;
}
function fbPrompt() {
  const tpl = $('fbTemplateBody').value;
  return [
    '你是老师的家长沟通助手。请按下面的模板和事实，写一段可以直接发给家长的反馈。',
    '模板：', tpl,
    '事实：',
    '学生：' + ($('fbStudent').value.trim() || '同学'),
    '课题/场景：' + ($('fbTopic').value.trim() || '本次课'),
    '表现/进步：' + ($('fbGood').value.trim() || '未提供'),
    '问题/需要加强：' + ($('fbBad').value.trim() || '未提供'),
    '下一步/家长配合：' + ($('fbNext').value.trim() || '未提供'),
    '家长诉求/语气：' + ($('fbAsk').value.trim() || '未提供'),
    '要求：200~400 字；具体、自然、不夸张；缺的信息用【待补】；不要编造分数和排名；不要提“AI”“模型”；结尾署名“' + (state.settings.teacher || '老师') + '”。',
  ].join('\n');
}
async function generateFeedback() {
  if (!aiConfigured()) {
    $('fbOut').value = fillTemplateText();
    renderPreview('fb'); setPreview('fb', 'html');
    syncStateNow();
    return toast('未配置 AI，已直接套模板；配置后 AI 会写得更自然。', '', 4500);
  }
  showOverlay('生成反馈中…', '正在按模板和事实写', true);
  const ctrl = new AbortController(); overlayAbort = ctrl;
  try {
    const text = await callAI({
      messages: [
        { role: 'system', content: '你写的家长反馈要像老师本人写的：具体、克制、有下一步。' },
        { role: 'user', content: fbPrompt() },
      ],
      maxTokens: 1600,
      temperature: 0.55,
      signal: ctrl.signal,
    });
    $('fbOut').value = text.trim();
    renderPreview('fb'); setPreview('fb', 'html');
    syncStateNow();
    toast('已生成，可改后复制', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') toast('已停止', '', 2000);
    else toast('生成失败：' + (e && e.message || e), 'bad', 5000);
  } finally { hideOverlay(); }
}
async function exportFbDocx() {
  const text = $('fbOut').value.trim();
  if (!text) return toast('还没有反馈内容', 'bad');
  const student = $('fbStudent').value.trim() || '同学';
  try {
    const blob = await window.TADocx.fromMarkdown({
      title: '家长反馈',
      subtitle: student + ' · ' + ($('fbTopic').value.trim() || '本次课'),
      meta: ['日期：' + today() + '　老师：' + (state.settings.teacher || '未填写')],
      md: text,
    });
    window.TADocx.download('家长反馈_' + window.TADocx.safeName(student) + '_' + today() + '.docx', blob);
    toast('已导出', 'ok');
  } catch (e) { toast('导出失败：' + (e && e.message || e), 'bad', 5000); }
}

/* ══════════════ 打印 ══════════════ */
function printHtml(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) return toast('浏览器拦截了新窗口，请允许弹窗后重试', 'bad');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
    'body{font-family:"Songti SC",SimSun,serif;color:#1f2a2e;line-height:1.8;max-width:820px;margin:26px auto;padding:0 22px;font-size:12pt}' +
    'h1{font-family:"Heiti SC",SimHei,sans-serif;text-align:center;font-size:20pt;margin:0 0 6px}' +
    'h2{font-family:"Heiti SC",SimHei,sans-serif;font-size:14pt;border-left:4px solid #0f766e;padding-left:10px;margin:20px 0 8px}' +
    'h3{font-size:12pt;margin:14px 0 4px}.sub{text-align:center;color:#555;margin:0 0 4px}.meta{text-align:center;color:#666;font-size:10.5pt;margin:2px 0}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0;font-size:10pt}th,td{border:1px solid #999;padding:5px 6px;text-align:left;vertical-align:top}th{background:#eef3f2}' +
    'blockquote{border-left:3px solid #ccc;margin:8px 0;padding:4px 10px;color:#555;background:#f7f6f2}' +
    '@media print{body{margin:0;padding:0}.noprint{display:none}}' +
    '</style></head><body>' + bodyHtml + '</body></html>';
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 400);
}

/* ══════════════ 设置 ══════════════ */
function fillSettings() {
  const s = state.settings;
  $('cfgProvider').value = s.provider || 'deepseek';
  $('cfgModel').value = s.model || '';
  $('cfgVisionModel').value = s.visionModel || '';
  $('cfgKey').value = s.apiKey || '';
  $('cfgProxyUrl').value = s.proxyUrl || '';
  $('cfgProxyToken').value = s.proxyToken || '';
  $('cfgProxyProvider').value = s.proxyProvider || 'deepseek';
  $('cfgProxyModel').value = s.model || '';
  $('cfgProxyVisionModel').value = s.visionModel || '';
  $('cfgTeacher').value = s.teacher || '';
  qsa('.mode-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === s.mode));
  $('directBox').hidden = s.mode === 'proxy';
  $('proxyBox').hidden = s.mode !== 'proxy';
  updateAiStatus();
}
function saveSettings() {
  const s = state.settings;
  s.mode = qs('.mode-seg .seg-btn.active').dataset.mode;
  s.provider = $('cfgProvider').value;
  s.model = $('cfgModel').value.trim();
  s.visionModel = $('cfgVisionModel').value.trim();
  s.apiKey = $('cfgKey').value.trim();
  s.proxyUrl = $('cfgProxyUrl').value.trim();
  s.proxyToken = $('cfgProxyToken').value.trim();
  s.proxyProvider = $('cfgProxyProvider').value;
  s.teacher = $('cfgTeacher').value.trim();
  if (s.mode === 'proxy') {
    if (!/^https?:\/\//i.test(s.proxyUrl)) return toast('代理地址要以 https:// 开头', 'bad');
    if (!s.proxyToken) return toast('填一下团队访问口令', 'bad');
    s.model = $('cfgProxyModel').value.trim() || (s.proxyProvider === 'glm' ? 'glm-4-flash' : 'deepseek-flash');
    s.visionModel = $('cfgProxyVisionModel').value.trim() || (s.proxyProvider === 'glm' ? 'glm-4.6v-flash' : 'deepseek-flash');
  } else {
    if (!s.apiKey) return toast('填一下 API Key，或切到团队代理模式', 'bad');
    if (!s.model) s.model = s.provider === 'glm' ? 'glm-4-flash' : 'deepseek-flash';
    if (!s.visionModel) s.visionModel = s.provider === 'glm' ? 'glm-4.6v-flash' : 'deepseek-flash';
  }
  saveState();
  updateAiStatus();
  fillSettings();
  toast('设置已保存', 'ok');
}
async function testAI() {
  const msg = $('cfgTestMsg');
  msg.style.color = '';
  msg.textContent = '测试中…（最长 60 秒）';
  try {
    const s = state.settings;
    if (s.mode === 'direct' && s.provider === 'deepseek') {
      const res = await fetchTimeout('https://api.deepseek.com/models', {
        headers: { Authorization: 'Bearer ' + s.apiKey },
      }, 20000);
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(apiError(j, res.status));
      const n = j && Array.isArray(j.data) ? j.data.length : 0;
      msg.textContent = '连接正常（DeepSeek 可用模型 ' + n + ' 个）';
      msg.style.color = 'var(--ok)';
      toast('AI 连接正常', 'ok');
      return;
    }
    if (s.mode === 'proxy') {
      try {
        const hr = await fetchTimeout((s.proxyUrl || '').replace(/\/+$/, '') + '/v1/health', { headers: { Authorization: 'Bearer ' + s.proxyToken } }, 15000);
        if (hr.ok) {
          const hj = await hr.json().catch(() => null);
          msg.textContent = '代理连接正常' + (hj && hj.keys ? ('（可用：' + Object.keys(hj.keys).filter((k) => hj.keys[k]).join(' / ') + '）') : '');
          msg.style.color = 'var(--ok)';
          toast('代理连接正常', 'ok');
          return;
        }
      } catch (_) {}
    }
    const text = await callAI({
      messages: [{ role: 'user', content: '只回复两个字：正常' }],
      maxTokens: 1024,
      temperature: 0,
      timeout: 60000,
    });
    msg.textContent = '连接正常：' + text.trim().slice(0, 20);
    msg.style.color = 'var(--ok)';
    toast('AI 连接正常', 'ok');
  } catch (e) {
    msg.textContent = '失败：' + (e && e.message || e);
    msg.style.color = 'var(--danger)';
    toast('连接失败：' + (e && e.message || e), 'bad', 6000);
  }
}
function exportData() {
  const copy = JSON.parse(JSON.stringify(state));
  copy.settings = Object.assign({}, copy.settings, { apiKey: '', proxyToken: '' });
  copy._note = '导出的数据不含 API Key / 访问口令；换电脑后请重新填写。';
  const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = '教学助手轻量版数据_' + today() + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1200);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(String(r.result));
      if (!j || typeof j !== 'object') throw new Error('不是有效 JSON');
      if (j.templates && Array.isArray(j.templates)) state.templates = j.templates;
      if (j.drafts && Array.isArray(j.drafts)) state.drafts = j.drafts;
      if (j.settings) {
        const keep = state.settings;
        state.settings = Object.assign({}, DEFAULT_SETTINGS, j.settings, { apiKey: keep.apiKey, proxyToken: keep.proxyToken });
      }
      saveState(); renderDrafts(); renderTemplateList(); fillSettings();
      toast('导入完成（Key 未导入，请重新填写）', 'ok', 4500);
    } catch (e) { toast('导入失败：' + (e && e.message || e), 'bad', 5000); }
  };
  r.readAsText(file);
}

/* ══════════════ 示例数据 ══════════════ */
function examDemo() {
  examFiles = [];
  renderExamFiles();
  $('exStudent').value = '示例同学';
  $('exGrade').value = '六年级';
  $('exName').value = '圆的面积单元测';
  $('exDate').value = today();
  $('exFull').value = '50';
  $('exSubject').value = '数学';
  state.exam.questions = [
    { no: '1', stem: '一个圆的半径是 3 cm，面积是多少？', answer: '9π cm²', studentAnswer: '9π cm²', correct: true, score: 10, maxScore: 10, knowledge: '圆的面积', errorType: '', analysis: '公式使用正确。' },
    { no: '2', stem: '一个圆的直径是 10 cm，面积是多少？', answer: '25π cm²', studentAnswer: '100π cm²', correct: false, score: 0, maxScore: 10, knowledge: '圆的面积', errorType: '概念不清', analysis: '把直径当半径，先用 10÷2=5 再平方。' },
    { no: '3', stem: '环形内圆半径 2 cm，外圆半径 5 cm，求阴影面积。', answer: '21π cm²', studentAnswer: '21π cm²', correct: true, score: 10, maxScore: 10, knowledge: '圆环面积', errorType: '', analysis: '大圆减小圆，正确。' },
    { no: '4', stem: '一个半圆的半径是 4 cm，周长是多少？', answer: '4π+8 cm', studentAnswer: '4π cm', correct: false, score: 4, maxScore: 10, knowledge: '半圆周长', errorType: '步骤缺失', analysis: '漏了直径那条边。' },
    { no: '5', stem: '圆的面积和半径成正比例吗？说明理由。', answer: '不成正比例，面积与半径的平方成正比', studentAnswer: '成正比例', correct: false, score: 2, maxScore: 10, knowledge: '正比例', errorType: '概念不清', analysis: '面积/半径=πr，不是定值。' },
  ];
  renderExamTable(); renderExamStats(); updateExamButtons();
  $('btnExamAnalyze').disabled = false;
  $('examAnalysis').value = localExamAnalysis();
  renderPreview('exam');
  setPreview('exam', 'html');
  syncStateNow();
  toast('已填入示例，可直接看导出效果', 'ok');
}
function scoreDemo() {
  $('scoreInput').value = '92\n85\n78\n66\n95\n58\n88\n73\n81\n90\n64\n77';
  $('scoreFull').value = '100';
  renderScoreStats();
  const st = scoreStats(parseScores($('scoreInput').value), 100);
  const md = localScoreAnalysis(st, 100);
  $('scoreAnalysis').innerHTML = window.TAMD.render(md);
  $('scoreAnalysis').classList.remove('empty');
  $('scoreAnalysis').dataset.md = md;
}
function lessonDemo() {
  lessonKind = 'trial';
  qsa('#lessonKindChips .chip').forEach((b) => b.classList.toggle('active', b.dataset.kind === 'trial'));
  $('lsStage').value = '小学';
  $('lsGrade').value = '六年级';
  $('lsSubject').value = '数学';
  $('lsBook').value = '苏教版';
  $('lsTopic').value = '圆的面积：割补与容斥';
  $('lsDuration').value = '60 分钟';
  $('lsStudent').value = '示例同学';
  $('lsSituation').value = '基础一般，计算容易错；家长想看到提分路径。';
  $('lsExtra').value = '试听最后留 10 分钟和家长沟通。';
  $('lessonOut').value = localLesson(lessonFields());
  renderPreview('lesson'); setPreview('lesson', 'md');
  syncStateNow();
}
function fbDemo() {
  $('fbStudent').value = '示例同学';
  $('fbTopic').value = '圆的面积第 2 次课';
  $('fbGood').value = '这次计算全对；能自己画图解释为什么先算半径的平方。';
  $('fbBad').value = '单位换算还会漏；审题有点急。';
  $('fbNext').value = '每天 3 道单位换算；下次课做综合题。';
  $('fbAsk').value = '家长关心提分；语气温和、具体，不夸张。';
  $('fbOut').value = fillTemplateText();
  renderPreview('fb'); setPreview('fb', 'html');
  syncStateNow();
}

/* ══════════════ 绑定 ══════════════ */
function bind() {
  // tabs
  qsa('.tab').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
  // preview segs
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-preview]');
    if (!b) return;
    const kind = b.dataset.preview;
    if (!kind) return;
    const isMd = /原文|Markdown/.test(b.textContent);
    setPreview(kind, isMd ? 'md' : 'html');
  });
  // exam file
  const drop = $('examDrop');
  const input = $('examFile');
  drop.onclick = () => input.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { addExamFiles(input.files); input.value = ''; };
  ['dragover', 'dragenter'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) addExamFiles(e.dataTransfer.files); });
  $('btnExamExtract').onclick = extractExam;
  $('btnExamStop').onclick = () => { if (overlayAbort) overlayAbort.abort(); };
  $('btnExamClear').onclick = () => {
    if (!confirm('清空本页的试卷图片、本次信息、逐题结果和分析文字？')) return;
    examFiles = []; state.exam.questions = []; state.exam.analysis = '';
    ['exStudent', 'exGrade', 'exName', 'exFull'].forEach((id) => { $(id).value = ''; });
    $('exDate').value = today();
    $('exSubject').value = '数学';
    renderExamFiles(); renderExamTable(); renderExamStats();
    $('examAnalysis').value = ''; renderPreview('exam');
    $('btnExamAnalyze').disabled = true; updateExamButtons();
    syncStateNow();
    toast('已清空', '', 1800);
  };
  $('btnExamDemo').onclick = examDemo;
  $('btnExamAddRow').onclick = () => { state.exam.questions.push(examQuestionTemplate(state.exam.questions.length)); renderExamTable(); renderExamStats(); saveState(); };
  $('btnExamAnalyze').onclick = analyzeExam;
  $('btnExamDocx').onclick = exportExamDocx;
  $('btnExamErrDocx').onclick = exportErrDocx;
  $('btnExamCopy').onclick = async () => {
    const t = $('examAnalysis').value.trim();
    if (!t) return toast('还没有分析文字', 'bad');
    try { await navigator.clipboard.writeText(t); toast('已复制', 'ok'); } catch (_) { toast('复制失败，请手动选中', 'bad'); }
  };
  $('btnExamPrint').onclick = () => printHtml('试卷分析报告', buildExamPrintHtml());
  ['exStudent', 'exGrade', 'exName', 'exDate', 'exFull', 'exSubject'].forEach((id) => $(id).addEventListener('input', () => { syncExamMeta(); renderExamStats(); }));
  $('examAnalysis').addEventListener('input', debounce(() => { renderPreview('exam'); saveState(); }, 200));

  // score
  $('btnScoreCalc').onclick = () => { renderScoreStats(); };
  $('btnScoreAnalyze').onclick = analyzeScores;
  $('btnScoreDocx').onclick = exportScoreDocx;

  // lesson
  qsa('#lessonKindChips .chip').forEach((b) => b.onclick = () => {
    lessonKind = b.dataset.kind;
    state.lesson.kind = lessonKind;
    qsa('#lessonKindChips .chip').forEach((x) => x.classList.toggle('active', x === b));
    saveState();
  });
  $('btnLessonGen').onclick = generateLesson;
  $('btnLessonStop').onclick = () => { if (overlayAbort) overlayAbort.abort(); };
  $('btnLessonDocx').onclick = exportLessonDocx;
  $('btnLessonCopy').onclick = async () => {
    const t = $('lessonOut').value.trim();
    if (!t) return toast('还没有教案', 'bad');
    try { await navigator.clipboard.writeText(t); toast('已复制', 'ok'); } catch (_) { toast('复制失败', 'bad'); }
  };
  $('btnLessonPrint').onclick = () => printHtml('教案', window.TAMD.render($('lessonOut').value.trim() || ''));
  $('btnLessonSave').onclick = saveLessonDraft;
  $('btnLessonDemo').onclick = lessonDemo;
  $('btnLessonClear').onclick = () => {
    if (!confirm('清空当前教案表单和内容？')) return;
    ['lsGrade', 'lsBook', 'lsTopic', 'lsDuration', 'lsStudent', 'lsSituation', 'lsExtra'].forEach((id) => $(id).value = '');
    $('lessonOut').value = ''; renderPreview('lesson');
  };
  $('lessonOut').addEventListener('input', debounce(() => { renderPreview('lesson'); saveState(); }, 200));

  // feedback
  $('btnFbGen').onclick = generateFeedback;
  $('btnFbFill').onclick = () => { $('fbOut').value = fillTemplateText(); renderPreview('fb'); setPreview('fb', 'html'); syncStateNow(); };
  $('btnFbCopy').onclick = async () => {
    const t = $('fbOut').value.trim();
    if (!t) return toast('还没有反馈', 'bad');
    try { await navigator.clipboard.writeText(t); toast('已复制', 'ok'); } catch (_) { toast('复制失败', 'bad'); }
  };
  $('btnFbDocx').onclick = exportFbDocx;
  $('btnFbPrint').onclick = () => printHtml('家长反馈', window.TAMD.render($('fbOut').value.trim() || ''));
  $('btnFbDemo').onclick = fbDemo;
  $('btnFbClear').onclick = () => { ['fbStudent', 'fbTopic', 'fbGood', 'fbBad', 'fbNext', 'fbAsk', 'fbOut'].forEach((id) => $(id).value = ''); renderPreview('fb'); };
  $('btnFbSaveTpl').onclick = () => {
    const t = currentTemplate();
    if (!t) return;
    t.body = $('fbTemplateBody').value;
    t.name = t.name || '未命名模板';
    saveState(); renderTemplateList(); toast('模板已保存', 'ok');
  };
  $('btnFbNewTpl').onclick = () => {
    const name = prompt('模板名称', '新模板');
    if (!name) return;
    const t = { id: 'tpl' + Date.now(), name: name, body: '## 反馈\n\n{学生}家长您好，……' };
    state.templates.push(t);
    state.feedback.templateId = t.id;
    $('fbTemplateBody').value = t.body;
    saveState(); renderTemplateList();
  };
  $('btnFbDelTpl').onclick = () => {
    const t = currentTemplate();
    if (!t || state.templates.length <= 1) return toast('至少保留一个模板', 'bad');
    if (!confirm('删除模板「' + t.name + '」？')) return;
    state.templates = state.templates.filter((x) => x.id !== t.id);
    state.feedback.templateId = state.templates[0].id;
    $('fbTemplateBody').value = state.templates[0].body;
    saveState(); renderTemplateList();
  };
  $('fbOut').addEventListener('input', debounce(() => { renderPreview('fb'); saveState(); }, 200));

  // settings
  qsa('.mode-seg .seg-btn').forEach((b) => b.onclick = () => {
    qsa('.mode-seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('directBox').hidden = b.dataset.mode !== 'direct';
    $('proxyBox').hidden = b.dataset.mode !== 'proxy';
  });
  $('cfgProvider').onchange = () => {
    const p = $('cfgProvider').value;
    if (!state.settings.provider || state.settings.provider !== p) {
      $('cfgModel').value = p === 'glm' ? 'glm-4-flash' : 'deepseek-flash';
      $('cfgVisionModel').value = p === 'glm' ? 'glm-4.6v-flash' : 'deepseek-flash';
    }
  };
  $('cfgProxyProvider').onchange = () => {
    const p = $('cfgProxyProvider').value;
    $('cfgProxyModel').value = p === 'glm' ? 'glm-4-flash' : 'deepseek-flash';
    $('cfgProxyVisionModel').value = p === 'glm' ? 'glm-4.6v-flash' : 'deepseek-flash';
  };
  $('btnCfgSave').onclick = saveSettings;
  $('btnCfgTest').onclick = async () => { saveSettings(); await testAI(); };
  $('btnQuickConfig').onclick = () => switchTab('settings');
  $('btnDataExport').onclick = exportData;
  $('btnDataImport').onclick = () => $('dataImportFile').click();
  $('dataImportFile').onchange = () => { const f = $('dataImportFile').files[0]; if (f) importData(f); $('dataImportFile').value = ''; };
  $('btnDataClear').onclick = () => {
    if (!confirm('清空本浏览器的全部设置、草稿、模板和结果？这会删除本地数据，不可恢复。')) return;
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    location.reload();
  };
  $('ovCancel').onclick = () => { if (overlayAbort) overlayAbort.abort(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('overlay').hidden && overlayAbort) overlayAbort.abort(); });
}

/* ══════════════ 启动 ══════════════ */
function hydrate() {
  $('exStudent').value = state.exam.student || '';
  $('exGrade').value = state.exam.grade || '';
  $('exName').value = state.exam.name || '';
  $('exDate').value = state.exam.date || today();
  $('exFull').value = state.exam.full || '';
  $('exSubject').value = state.exam.subject || '数学';
  $('examAnalysis').value = state.exam.analysis || '';
  renderExamTable(); renderExamStats();
  $('btnExamAnalyze').disabled = !state.exam.questions.length;

  lessonKind = state.lesson.kind || 'new';
  qsa('#lessonKindChips .chip').forEach((b) => b.classList.toggle('active', b.dataset.kind === lessonKind));
  $('lsStage').value = state.lesson.stage || '小学';
  $('lsGrade').value = state.lesson.grade || '';
  $('lsSubject').value = state.lesson.subject || '数学';
  $('lsBook').value = state.lesson.book || '';
  $('lsTopic').value = state.lesson.topic || '';
  $('lsDuration').value = state.lesson.duration || '';
  $('lsStudent').value = state.lesson.student || '';
  $('lsSituation').value = state.lesson.situation || '';
  $('lsExtra').value = state.lesson.extra || '';
  $('lessonOut').value = state.lesson.out || '';
  renderDrafts();

  $('fbStudent').value = state.feedback.student || '';
  $('fbTopic').value = state.feedback.topic || '';
  $('fbGood').value = state.feedback.good || '';
  $('fbBad').value = state.feedback.bad || '';
  $('fbNext').value = state.feedback.next || '';
  $('fbAsk').value = state.feedback.ask || '';
  $('fbOut').value = state.feedback.out || '';
  renderTemplateList();
  const t = currentTemplate();
  if (t) $('fbTemplateBody').value = t.body;

  fillSettings();
  renderPreview('exam'); renderPreview('lesson'); renderPreview('fb');
  setPreview('exam', 'md'); setPreview('lesson', 'md'); setPreview('fb', 'md');
  updateExamButtons();
  updateAiStatus();
  switchTab(state.lastTab || 'exam');
}

function bindPersistence() {
  // 所有表单在输入时同步到 state（轻量、够用）
  document.addEventListener('input', debounce(syncStateNow, 250));
}

loadState();
bind();
bindPersistence();
hydrate();

/* 调试/自检入口（只读为主，方便自动化验收） */
try {
  window.__taLite = {
    version: APP_VERSION,
    state: state,
    examStats: examStats,
    examBlocks: examBlocks,
    localExamAnalysis: localExamAnalysis,
    localLesson: localLesson,
    lessonFields: lessonFields,
    scoreStats: scoreStats,
    parseScores: parseScores,
  };
} catch (_) {}
