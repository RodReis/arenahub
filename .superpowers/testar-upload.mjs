/**
 * Testa o upload ponta a ponta contra a API real: login, envia os dois
 * laudos na MESMA sessão, e mostra o que voltou. Descartável.
 */
const API = 'http://localhost:3344';
const STUDENT = '073c08cd-ddea-487c-9075-3d56e1e77cc5';

const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'dono@arena-positiva.test',
    password: 'senha-de-bancada-arenahub',
  }),
});

if (!login.ok) {
  console.log('login falhou:', login.status, (await login.text()).slice(0, 200));
  process.exit(1);
}

const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
console.log('login ok');

const fs = await import('node:fs/promises');

async function enviar(caminho, nome, sessionId, ultimo = false) {
  let conteudo = await fs.readFile(caminho);
  const ehPdf = nome.endsWith('.pdf');

  // O ECG real chega como PDF; o fixture e o texto ja extraido. O prefixo
  // satisfaz a checagem de assinatura, e o extrator le o resto como UTF-8.
  if (ehPdf) conteudo = Buffer.concat([Buffer.from('%PDF-1.7'), conteudo]);

  const fd = new FormData();
  fd.append('file', new Blob([conteudo], { type: ehPdf ? 'application/pdf' : 'text/csv' }), nome);
  if (sessionId) fd.append('reviewSessionId', sessionId);
  fd.append('sourceLabel', nome.replace(/\.[^.]+$/, ''));
  fd.append('ultimoDaSessao', ultimo ? 'true' : 'false');

  const r = await fetch(`${API}/api/v1/students/${STUDENT}/assessment-imports`, {
    method: 'POST',
    headers: { cookie },
    body: fd,
  });

  const corpo = await r.text();
  return { status: r.status, corpo: corpo.slice(0, 300) };
}

const a = await enviar('.superpowers/cf610g.csv', 'CF610_G.csv', null);
console.log('arquivo 1:', a.status, a.corpo);

if (a.status !== 201) process.exit(1);

const sessionId = JSON.parse(a.corpo).reviewSessionId;

const b = await enviar('.superpowers/unique.csv', 'Unique Health.csv', sessionId);
console.log('arquivo 2:', b.status, b.corpo);

const c = await enviar('.superpowers/ecg.txt', 'ECG 30s.pdf', sessionId, true);
console.log('arquivo 3 (ultimo):', c.status, c.corpo);

console.log(`\nURL: http://localhost:3001/students/${STUDENT}/health/imports/${sessionId}`);
