#!/usr/bin/env node
// Cria os 3 tópicos do grupo "Hermes Secretário" e imprime as env vars prontas.
// Pré-requisitos: grupo já é fórum (Tópicos ativados) e o bot é admin com
// permissão "Manage Topics".
//
// Uso: TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=-100... node setup-topics.mjs

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
  console.error('defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no ambiente');
  process.exit(2);
}

const TOPICOS = [
  ['📡 Radar', 'TELEGRAM_TOPIC_RADAR'],
  ['🏠 Tarefas Pessoais', 'TELEGRAM_TOPIC_PESSOAL'],
  ['🏢 Tarefas Empresa', 'TELEGRAM_TOPIC_EMPRESA'],
];

const linhas = [];
for (const [name, envName] of TOPICOS) {
  const res = await fetch(`https://api.telegram.org/bot${token}/createForumTopic`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, name }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`falha criando topico "${name}": ${data.description}`);
    console.error('confira: grupo com Topicos ativados + bot admin com Manage Topics');
    process.exit(1);
  }
  linhas.push(`${envName}=${data.result.message_thread_id}`);
}

console.log('# Copie pro ambiente do agente:');
console.log(linhas.join('\n'));
