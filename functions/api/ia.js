// functions/api/ia.js
// Proxy seguro: recibe prompts del frontend y llama a Groq con la key secreta.

const ALLOWED_ORIGINS = [
  'https://alegc-tools.pages.dev',
  'https://sukyozumaru.github.io'
];

const SYSTEM_PROMPT = 'Eres un asistente útil, directo y sin relleno. Respondes SIEMPRE en español. Cuando te pidan JSON, devuelves solo JSON válido, sin texto adicional ni bloques de código.';

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

  // Construye el array de mensajes para Groq
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
    if (prompt.length > 12000) {
      return json({ error: 'Prompt demasiado largo', code: 'too_long' }, 400, origin);
    }
    groqMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ];
  } else {
    return json({ error: 'Falta prompt o messages', code: 'bad_request' }, 400, origin);
  }

     // Modelos en orden de preferencia: si el primero falla, intenta el siguiente
    const MODELOS_DISPONIBLES = [
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'llama-3.1-8b-instant',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'gemma2-9b-it'
    ];

    let ultimoError = null;
    let respuestaGroq = null;

    for (const modelo of MODELOS_DISPONIBLES) {
      const groqBody = {
        model: modelo,
        messages: groqMessages,
        max_tokens: Math.min(Math.max(256, maxTokens), 4096),
        temperature: Math.min(Math.max(0, temperature), 2)
      };
      if (jsonMode) groqBody.response_format = { type: 'json_object' };

      try {
        const intento = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(groqBody)
        });

        if (intento.ok) {
          respuestaGroq = intento;
          break;
        }

        const errData = await intento.json().catch(() => ({}));
        const errMsg = errData?.error?.message || '';

        // Si es error de "modelo no existe", probamos el siguiente
        if (errMsg.includes('does not exist') || errMsg.includes('do not have access')) {
          ultimoError = errMsg;
          continue;
        }

        // Si es otro error (rate limit, auth, etc), devolvemos ese
        respuestaGroq = intento;
        break;
      } catch (e) {
        ultimoError = 'Error de red: ' + e.message;
        continue;
      }
    }

    if (!respuestaGroq) {
      return json({
        error: 'Ningún modelo disponible funcionó. Último error: ' + ultimoError,
        code: 'no_model'
      }, 500, origin);
    }

    const groqRes = respuestaGroq;
  if (jsonMode) {
    groqBody.response_format = { type: 'json_object' };
  }

  let groqRes;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(groqBody)
    });
  } catch {
    return json({ error: 'No se pudo contactar a Groq', code: 'upstream' }, 502, origin);
  }

  let data;
  try {
    data = await groqRes.json();
  } catch {
    return json({ error: 'Respuesta inválida de Groq', code: 'upstream' }, 502, origin);
  }

  if (!groqRes.ok) {
    const code = groqRes.status === 429 ? 'rate_limited' : 'upstream';
    return json({
      error: data?.error?.message || 'Error al generar',
      code
    }, groqRes.status, origin);
  }

  const text = data?.choices?.[0]?.message?.content || '';
  return json({ text }, 200, origin);
}
