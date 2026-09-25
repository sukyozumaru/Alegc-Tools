// functions/api/ia.js
// Proxy seguro: recibe prompts del frontend y llama a Groq con la key secreta.

const ALLOWED_ORIGINS = [
  'https://alegc-tools.pages.dev',
  'https://sukyozumaru.github.io'
];

const SYSTEM_PROMPT = 'Eres un asistente útil, directo y sin relleno. Respondes SIEMPRE en español. Cuando te pidan JSON, devuelves solo JSON válido, sin texto adicional ni bloques de código.';

// Modelos en orden de preferencia (se irán probando si el anterior falla)
const MODELOS_DISPONIBLES = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3-32b',
  'gemma2-9b-it'
];

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: cors(request.headers.get('Origin') || '') });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido', code: 'bad_request' }, 400, origin);
  }

  const { prompt, messages, jsonMode, maxTokens = 2048, temperature = 0.8 } = body || {};

  // Construir array de mensajes
  let groqMessages;
  if (Array.isArray(messages) && messages.length > 0) {
    groqMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.slice(-12).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 4000)
      }))
    ];
  } else if (typeof prompt === 'string' && prompt.trim()) {
    if (prompt.length > 20000) {
      return json({ error: 'Prompt demasiado largo', code: 'too_long' }, 400, origin);
    }
    groqMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ];
  } else {
    return json({ error: 'Falta prompt o messages', code: 'bad_request' }, 400, origin);
  }

  const baseParams = {
    messages: groqMessages,
    max_tokens: Math.min(Math.max(256, maxTokens), 16000),
    temperature: Math.min(Math.max(0, temperature), 2)
  };

  let ultimoError = null;

  // Intento 1: con JSON mode si se pidió
  for (const modelo of MODELOS_DISPONIBLES) {
    const payload = { model: modelo, ...baseParams };
    if (jsonMode) payload.response_format = { type: 'json_object' };

    const resultado = await intentarGroq(payload, env.GROQ_API_KEY);
    if (resultado.ok) return json({ text: resultado.text }, 200, origin);

    // Si el modelo no existe, probamos el siguiente
    if (resultado.reason === 'no_model') {
      ultimoError = resultado.message;
      continue;
    }

    // Si Groq falla porque el modelo generó JSON inválido (comentarios, texto extra, etc),
    // reintentamos SIN json_mode y extraemos el JSON manualmente
    if (resultado.reason === 'json_invalid' && jsonMode) {
      const payloadSinJson = { model: modelo, ...baseParams };
      const retry = await intentarGroq(payloadSinJson, env.GROQ_API_KEY);
      if (retry.ok) {
        const cleaned = retry.text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          return json({ text: cleaned.slice(firstBrace, lastBrace + 1) }, 200, origin);
        }
        return json({ text: cleaned }, 200, origin);
      }
      ultimoError = retry.message;
      continue;
    }

    // Si falla por JSON mode, reintentamos sin él (mismo modelo)
    if (resultado.reason === 'json_mode_unsupported' && jsonMode) {
      const payloadSinJson = { model: modelo, ...baseParams };
      const retry = await intentarGroq(payloadSinJson, env.GROQ_API_KEY);
      if (retry.ok) return json({ text: retry.text }, 200, origin);
      ultimoError = retry.message;
      continue;
    }

    // Otros errores (rate limit, auth, etc) los devolvemos directo
    const code = resultado.status === 429 ? 'rate_limited' : 'upstream';
    return json({ error: resultado.message, code }, resultado.status || 500, origin);
  }

  return json({
    error: 'Ningún modelo disponible respondió. Último error: ' + (ultimoError || 'desconocido'),
    code: 'no_model'
  }, 500, origin);
}

async function intentarGroq(payload, apiKey) {
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return { ok: false, status: 502, reason: 'network', message: 'Error de red: ' + e.message };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: 502, reason: 'parse', message: 'Respuesta inválida de Groq' };
  }

  if (res.ok) {
    const text = data?.choices?.[0]?.message?.content || '';
    return { ok: true, text };
  }

  const errMsg = data?.error?.message || 'Error desconocido';

  // Detectar problemas específicos
  if (errMsg.includes('does not exist') || errMsg.includes('do not have access') || errMsg.includes('model_not_found')) {
    return { ok: false, status: res.status, reason: 'no_model', message: errMsg };
  }

  // Algunos modelos no soportan response_format json_object
  if (errMsg.includes('response_format') || errMsg.includes('json_object') || errMsg.includes('json mode')) {
    return { ok: false, status: res.status, reason: 'json_mode_unsupported', message: errMsg };
  }

  return { ok: false, status: res.status, reason: 'other', message: errMsg };
}

  if (errMsg.includes('validate JSON') || errMsg.includes('failed_generation') || errMsg.includes('json_validate_failed') || errMsg.includes('Failed to validate')) {
    return { ok: false, status: res.status, reason: 'json_invalid', message: errMsg };
  }