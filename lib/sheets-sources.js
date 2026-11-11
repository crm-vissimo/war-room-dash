/* Planilhas (Monitoramento de Canais e Plano de Vendas do mês) lidas pela API do Google Sheets
   com uma conta de serviço. Compartilhe as planilhas com o e-mail da conta de serviço (leitor).
   O resultado passa pelos mesmos loaders de data.js, então o formato é o do dash no Claude. */
const { JWT } = require('google-auth-library');
const loaders = require('./loaders');

const CANAIS_ID = process.env.SHEET_MONITORAMENTO_CANAIS || '1TuXjU0vHez3qgezeV4RRNNJoa9AGKl4_v9xnW0dO7EA';
/* Plano de Vendas do mês: procurado no Drive, nas pastas do ano, pelo nome padrão "MM. M-1 Plano de Vendas MmmAA"
   (ex.: "12. M-1 Plano de Vendas Dez26"). Cópias com outro nome ("…Nov26_2", "…_V_Lays") não entram. Se o Drive não
   responder (pasta não compartilhada com a conta de serviço ou API do Drive desligada), usa os arquivos já conhecidos. */
const PASTAS_PLANO = (process.env.PLANO_PASTAS || '1Th-FGcCo-o8CHyyy8Ru1xMRGKORvcmme,1SwTpVU2Bp__kgzrAneJWZllLKT4D1zHr').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{10,80}$/.test(s));
const PLANOS_CONHECIDOS = { '2026-10': '1JcYd-hi0CbZjB3BntL8n-VPH1ZVQZEtn4Prc50XB5cA', '2026-11': '1Gq9dh7KfKH2OXOH3wtwjsbD66J0n_In4BAYtv6nD2nM' };
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const nomePlano = (mes) => `${mes.slice(5, 7)}. M-1 Plano de Vendas ${MESES[+mes.slice(5, 7) - 1]}${mes.slice(2, 4)}`;

let client = null;
function auth() {
  if (client) return client;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Google Sheets não configurado: falta GOOGLE_SERVICE_ACCOUNT_JSON');
  /* aceita o JSON colado de qualquer jeito: com espaços invisíveis (copiados de chat ou página),
     aspas curvas, aspas em volta do valor inteiro ou em base64 */
  let txt = String(raw).replace(/^﻿/, '').replace(/[   -​  　]/g, ' ').replace(/[“”]/g, '"').trim();
  if (/^'.*'$/s.test(txt)) txt = txt.slice(1, -1).trim();
  if (!txt.startsWith('{')) { try { const dec = Buffer.from(txt, 'base64').toString('utf8').trim(); if (dec.startsWith('{')) txt = dec; } catch (e) { /* segue */ } }
  let sa;
  try { sa = JSON.parse(txt); } catch (e) { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido (' + e.message + '). Cole o arquivo da conta de serviço inteiro, do { ao }.'); }
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON sem client_email ou private_key');
  if (sa.private_key.indexOf('\\n') >= 0) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.metadata.readonly'] });
  return client;
}
async function getValues({ spreadsheetId, range }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
  const r = await auth().request({ url });
  return { values: (r.data && r.data.values) || [] };
}
const run = async (id, args) => {
  const answer = JSON.stringify(await getValues(args));
  const call = async (tool, a) => JSON.stringify(await getValues(a));
  const out = await loaders.get(id)({ answer, args, call });
  return Array.isArray(out) ? out : out.rows;
};

const canais_diario = () => run('canais_diario', { spreadsheetId: CANAIS_ID, range: "'Receita | Real'!A642:U1100" });
/* id da planilha do Plano de Vendas do mês (AAAA-MM), guardado por 30 minutos */
const planoCache = new Map();
async function planoId(mes) {
  const hit = planoCache.get(mes);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.id;
  const nome = nomePlano(mes);
  let id = null;
  try {
    const q = `name = '${nome}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and (${PASTAS_PLANO.map((p) => `'${p}' in parents`).join(' or ')})`;
    const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q, orderBy: 'modifiedTime desc', pageSize: '5', fields: 'files(id,name,modifiedTime)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }).toString();
    const r = await auth().request({ url });
    const files = (r.data && r.data.files) || [];
    /* com mais de um arquivo de mesmo nome, vale o editado por último */
    if (files.length) id = files[0].id;
  } catch (e) {
    console.warn('[plano] Drive indisponível para buscar "' + nome + '": ' + (e && e.message));
  }
  if (!id) id = PLANOS_CONHECIDOS[mes] || null;
  if (!id) throw new Error('Plano de Vendas "' + nome + '" não encontrado nas pastas do Drive');
  planoCache.set(mes, { id, at: Date.now() });
  return id;
}
function plano(id, range) {
  return async ({ plano_mes }) => run(id, { spreadsheetId: await planoId(plano_mes), range });
}
const plano_cat = plano('plano_cat', "'Acompanhamento Categorias'!A5:H400");
const plano_diario = plano('plano_diario', "'6. Diarização'!C2:F40");

module.exports = { canais_diario, plano_cat, plano_diario };
