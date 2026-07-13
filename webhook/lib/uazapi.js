// Cliente minimo da uazapi -- so o que o Estagio 2 precisa: baixar o audio de
// uma mensagem ja capturada pra transcrever. Reaproveita as env vars que o
// webhook (Estagio 1) ja usa: UAZAPI_BASE_URL + UAZAPI_TOKEN.
// Autenticacao: header `token` com o token da INSTANCIA.

const BASE = () => (process.env.UAZAPI_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = () => process.env.UAZAPI_TOKEN || '';

// Baixa a midia de uma mensagem e retorna uma URL publica (mp3 para audio).
// POST /message/download { id, return_link, generate_mp3 }
export async function downloadAudioUrl(messageId) {
  const base = BASE();
  const token = TOKEN();
  if (!base || !token) throw new Error('Missing UAZAPI_BASE_URL or UAZAPI_TOKEN');

  const r = await fetch(`${base}/message/download`, {
    method: 'POST',
    headers: { token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: messageId,
      return_link: true,
      generate_mp3: true,
      return_base64: false,
    }),
  });
  if (!r.ok) throw new Error(`uazapi download ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const url = data.fileURL || data.url || data.link;
  if (!url) throw new Error('uazapi download sem fileURL');
  return url;
}
