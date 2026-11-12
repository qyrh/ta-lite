/* 教学助手 · 轻量版团队代理（Cloudflare Worker）
   作用：浏览器只拿“访问口令”，真实 DeepSeek / GLM Key 存在 Worker Secret 里，永不下发。
   路由：
     GET  /v1/health   → 有哪些供应商 Key 已配置（只回布尔）
     POST /v1/chat     → 转发到 DeepSeek / 智谱，返回 OpenAI 兼容 JSON
   部署：见同目录 README.md
*/
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ALLOWED_MODELS = {
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  glm: ['glm-4-flash', 'glm-4.6v-flash', 'glm-4v-flash'],
};
const MAX_BODY = 100 * 1024 * 1024;

function cors(env, request) {
  const allow = (env && env.ALLOWED_ORIGIN) || '*';
  const origin = request.headers.get('Origin') || '';
  const out = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-access-token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allow === '*') out['Access-Control-Allow-Origin'] = '*';
  else out['Access-Control-Allow-Origin'] = allow;
  if (origin && allow !== '*' && origin !== allow) out['Access-Control-Allow-Origin'] = allow;
  return out;
}
function json(data, status, env, request) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(env, request)),
  });
}
function err(message, status, env, request) {
  return json({ error: { message: message } }, status || 500, env, request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, request) });

    if (url.pathname === '/v1/health' && request.method === 'GET') {
      return json({
        ok: true,
        keys: {
          deepseek: !!env.DEEPSEEK_API_KEY,
          glm: !!env.GLM_API_KEY,
        },
        time: new Date().toISOString(),
      }, 200, env, request);
    }

    if (url.pathname !== '/v1/chat') return err('Not Found', 404, env, request);
    if (request.method !== 'POST') return err('Method Not Allowed', 405, env, request);

    // 访问口令
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim() || (request.headers.get('X-Access-Token') || '').trim();
    if (!env.ACCESS_TOKEN) return err('Worker 未设置 ACCESS_TOKEN', 500, env, request);
    if (!token || token !== env.ACCESS_TOKEN) return err('访问口令不正确', 401, env, request);

    let body;
    try { body = await request.json(); } catch (_) { return err('请求体不是 JSON', 400, env, request); }
    if (!body || typeof body !== 'object') return err('请求体为空', 400, env, request);

    const provider = body.provider === 'glm' ? 'glm' : 'deepseek';
    const key = provider === 'glm' ? env.GLM_API_KEY : env.DEEPSEEK_API_KEY;
    if (!key) return err('Worker 未配置 ' + provider + ' 的 API Key', 503, env, request);

    const allowed = ALLOWED_MODELS[provider] || [];
    let model = String(body.model || '').trim();
    if (!model) model = provider === 'glm' ? 'glm-4-flash' : 'deepseek-flash';
    if (allowed.indexOf(model) < 0) return err('模型不在白名单：' + model, 400, env, request);

    if (!Array.isArray(body.messages) || !body.messages.length) return err('缺少 messages', 400, env, request);
    if (body.messages.length > 40) return err('messages 过多', 400, env, request);
    const payload = {
      model: model,
      messages: body.messages,
      temperature: Math.max(0, Math.min(2, Number(body.temperature) || 0.3)),
      max_tokens: Math.max(1, Math.min(8192, Number(body.max_tokens) || 2048)),
      stream: false,
    };
    const bodyText = JSON.stringify(payload);
    if (bodyText.length > MAX_BODY) return err('请求体过大', 413, env, request);

    const target = provider === 'glm' ? GLM_URL : DEEPSEEK_URL;
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
        },
        body: bodyText,
      });
    } catch (e) {
      return err('上游连接失败：' + (e && e.message || e), 502, env, request);
    }

    const text = await upstream.text();
    // 只回传上游响应；错误信息里若意外带 Key 也做一次脱敏
    const safe = String(text || '').replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***').replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer ***');
    return new Response(safe, {
      status: upstream.status,
      headers: Object.assign({
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      }, cors(env, request)),
    });
  },
};
