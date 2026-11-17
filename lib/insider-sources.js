/* Insider One pelas APIs de relatório (a mesma chave INS.… do painel serve para e-mail e WhatsApp).
   Devolve o mesmo formato dos loaders de Insider do dash (email_insider, whats_insider, email_lista, email_cN). */
const EMAIL = 'https://analytics.api.useinsider.com/email/v2';
const WHATS = 'https://whatsapp.useinsider.com/v1/statistics/overall';

function key(kind) {
  const k = (kind === 'whats' && process.env.INSIDER_WHATSAPP_KEY) || process.env.INSIDER_API_KEY;
  if (!k) throw new Error('Insider não configurado: falta INSIDER_API_KEY');
  return k.trim();
}
/* datas do dash são dias de Brasília (UTC-3, sem horário de verão) */
const startOf = (d) => Math.floor(Date.parse(d + 'T00:00:00-03:00') / 1000);
const endOf = (d) => Math.min(Math.floor(Date.parse(d + 'T23:59:59-03:00') / 1000), Math.floor(Date.now() / 1000));

async function call(url, opts, kind) {
  const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ 'X-INS-AUTH-KEY': key(kind), accept: 'application/json' }, (opts && opts.headers) || {}) }));
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch (e) { j = null; }
  if (!r.ok) throw new Error('Insider ' + r.status + ': ' + ((j && (j.message || j.error)) ? JSON.stringify(j.message || j.error) : text).slice(0, 200));
  return j || {};
}
const num = (x) => +x || 0;
const rate = (x) => (x == null ? null : +x);

async function emailOverall({ ini, fim }) {
  const j = await call(`${EMAIL}/overall?startTime=${startOf(ini)}&endTime=${endOf(fim)}`);
  const s = (j.data && j.data.summary) || {};
  return [{ ini, fim, enviados: num(s.sent), entregues: num(s.delivered), taxa_entrega: rate(s.deliveryRate), taxa_abertura: rate(s.openRate), ctr: rate(s.clickThroughRate), cliques_unicos: num(s.uniqueClicks), conversoes: num(s.conversions) }];
}
/* WhatsApp do período: disparos manuais e réguas (mensagens de jornadas do Architect, show_architect). Os disparos vêm um
   por linha; o que as réguas somam além deles entra numa linha "Réguas (jornadas)" (regua: true), para os totais de
   entregues e o investimento baterem com o resumo do Insider. Se o Insider recusar show_architect, segue só com os disparos. */
async function whatsOverall({ ini, fim }) {
  const pedir = (comReguas) => call(WHATS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_time: startOf(ini), end_time: endOf(fim), campaign_filter: Object.assign({ campaign_type_ids: ['all'], statuses: ['all'] }, comReguas ? { show_architect: true } : {}) }),
  }, 'whats');
  let j, comReguas = true;
  try { j = await pedir(true); } catch (e) { if (!/Insider 4\d\d/.test(e.message)) throw e; comReguas = false; j = await pedir(false); }
  const rows = (j.details || []).map((c) => ({ ini, fim, campanha: c.campName, inicio: c.startsOn ? new Date(c.startsOn * 1000).toISOString() : null, enviados: num(c.sent), entregues: num(c.delivered), leituras: num(c.open), cliques: num(c.click), conversoes: num(c.conversion), regua: false }));
  const s = j.summary || {};
  if (comReguas && s.delivered != null) {
    const soma = (k) => rows.reduce((a, r) => a + r[k], 0);
    const resto = { enviados: num(s.sent) - soma('enviados'), entregues: num(s.delivered) - soma('entregues'), leituras: num(s.open) - soma('leituras'), cliques: num(s.click) - soma('cliques'), conversoes: num(s.conversion) - soma('conversoes') };
    if (resto.enviados > 0 || resto.entregues > 0) rows.push(Object.assign({ ini, fim, campanha: 'Réguas (jornadas)', inicio: null, regua: true }, Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, Math.max(0, v)]))));
  }
  return rows;
}
async function email_lista() {
  const pages = await Promise.all([1, 2].map((page) => call(`${EMAIL}/campaign/list?page=${page}&perPage=100`)));
  return [].concat(...pages.map((j) => j.data || [])).map((c) => ({ id: c.id, nome: c.name, inicio: c.startTime }));
}
async function emailCampaign(id, ini) {
  if (!id) return [];
  try {
    const j = await call(`${EMAIL}/campaign/statistics?campaignId=${encodeURIComponent(id)}&startTime=${startOf(ini)}`);
    const s = j.data && j.data.summary;
    if (!s) return [];
    /* entregues e aberturas da campanha; sem o total de aberturas no resumo, aberturas = entregues × open rate */
    const entregues = s.delivered == null ? null : num(s.delivered), openRate = s.openRate == null ? null : +s.openRate / 100;
    const abertas = [s.uniqueOpens, s.uniqueOpen, s.uniqueOpened, s.opened, s.opens].find((x) => x != null);
    return [{ id: String(id), enviados: num(s.sent), entregues, open_rate: openRate, aberturas: abertas != null ? num(abertas) : entregues != null && openRate != null ? Math.round(entregues * openRate) : null }];
  } catch (e) {
    if (/invalid campaign|not found/i.test(e.message)) return []; /* campanha fora da janela: segue sem estatística */
    throw e;
  }
}

module.exports = {
  email_insider: (p) => emailOverall({ ini: p.ini, fim: p.fim }),
  email_insider_mes: (p) => emailOverall({ ini: p.mtd_ini, fim: p.mtd_fim }),
  whats_insider: (p) => whatsOverall({ ini: p.ini, fim: p.fim }),
  whats_insider_mes: (p) => whatsOverall({ ini: p.mtd_ini, fim: p.mtd_fim }),
  email_lista,
  email_c1: (p) => emailCampaign(p.email_id_1, p.ini_email),
  email_c2: (p) => emailCampaign(p.email_id_2, p.ini_email),
  email_c3: (p) => emailCampaign(p.email_id_3, p.ini_email),
  email_c4: (p) => emailCampaign(p.email_id_4, p.ini_email),
  email_c5: (p) => emailCampaign(p.email_id_5, p.ini_email),
};
