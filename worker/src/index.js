const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const HISTORY_MAX = 60;

const PROFILE_DEFAULTS = {
  jogos: [], personagens: [], animais: [], dinossauros: [], herois: [],
  musicas: [], artistas: [], series: [], moda: [], redessociais: [],
  materias_faceis: [], materias_dificeis: [], frases_ok: [], humor: [],
  updatedAt: null,
};

const OLIVIA_DEFAULTS = {
  artistas: [], musicas: [], series: [], redessociais: [], moda: [],
  updatedAt: null,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function options() {
  return new Response(null, { status: 204, headers: CORS });
}

async function getProfile(env, user) {
  const raw = await env.PROFILES.get(`profile:${user}`);
  if (!raw) return user === 'theo' ? { ...PROFILE_DEFAULTS } : { ...OLIVIA_DEFAULTS };
  try { return JSON.parse(raw); } catch { return {}; }
}

async function saveProfile(env, user, data) {
  await env.PROFILES.put(`profile:${user}`, JSON.stringify(data));
}

async function getHistory(env, user) {
  const raw = await env.PROFILES.get(`history:${user}`);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function appendHistory(env, user, session) {
  const history = await getHistory(env, user);
  history.push(session);
  // Keep only the most recent HISTORY_MAX records
  const trimmed = history.slice(-HISTORY_MAX);
  await env.PROFILES.put(`history:${user}`, JSON.stringify(trimmed));
  return trimmed;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };

    if (method === 'OPTIONS') return options();

    // ── Claude API proxy ─────────────────────────────────────────
    if (method === 'POST' && pathname === '/') {
      const body = await request.text();
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body,
      });
      const data = await upstream.json();
      return json(data, upstream.status);
    }

    // ── GET /profile/:user ───────────────────────────────────────
    const profileGet = pathname.match(/^\/profile\/([a-z0-9_-]+)$/i);
    if (method === 'GET' && profileGet) {
      const profile = await getProfile(env, profileGet[1]);
      return json(profile);
    }

    // ── POST /profile/:user ──────────────────────────────────────
    const profilePost = pathname.match(/^\/profile\/([a-z0-9_-]+)$/i);
    if (method === 'POST' && profilePost) {
      const user = profilePost[1];
      const { patches } = await request.json();
      if (!patches || typeof patches !== 'object') return json({ error: 'patches obrigatório.' }, 400);
      const profile = await getProfile(env, user);
      for (const [cat, items] of Object.entries(patches)) {
        if (!Array.isArray(profile[cat])) profile[cat] = [];
        const set = new Set(profile[cat].map(s => String(s).toLowerCase()));
        for (const item of items) {
          if (!set.has(String(item).toLowerCase())) profile[cat].push(item);
        }
      }
      profile.updatedAt = new Date().toISOString();
      await saveProfile(env, user, profile);
      return json({ ok: true });
    }

    // ── GET /history/:user ───────────────────────────────────────
    const histGet = pathname.match(/^\/history\/([a-z0-9_-]+)$/i);
    if (method === 'GET' && histGet) {
      const history = await getHistory(env, histGet[1]);
      return json(history);
    }

    // ── POST /history/:user ──────────────────────────────────────
    const histPost = pathname.match(/^\/history\/([a-z0-9_-]+)$/i);
    if (method === 'POST' && histPost) {
      const user = histPost[1];
      const session = await request.json();
      if (!session || typeof session !== 'object') return json({ error: 'session obrigatório.' }, 400);
      session.savedAt = new Date().toISOString();
      const updated = await appendHistory(env, user, session);
      return json({ ok: true, total: updated.length });
    }

    return json({ error: 'Rota não encontrada.' }, 404);
  },
};
