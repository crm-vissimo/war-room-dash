/* Conexão com o Redshift (protocolo Postgres). As credenciais vêm só das variáveis de
   ambiente do projeto na Vercel — nunca do código. */
const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (pool) return pool;
  const need = ['REDSHIFT_HOST', 'REDSHIFT_DATABASE', 'REDSHIFT_USER', 'REDSHIFT_PASSWORD'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error('Redshift não configurado: faltam ' + missing.join(', '));
  pool = new Pool({
    host: process.env.REDSHIFT_HOST,
    port: +(process.env.REDSHIFT_PORT || 5439),
    database: process.env.REDSHIFT_DATABASE,
    user: process.env.REDSHIFT_USER,
    password: process.env.REDSHIFT_PASSWORD,
    ssl: process.env.REDSHIFT_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    statement_timeout: 55000,
  });
  return pool;
}

async function query(sql, params) {
  const r = await getPool().query(sql, params || []);
  return r.rows;
}

/* Tabelas no Redshift. Last click e grupo de produto usam as MESMAS views do dash no Claude
   (Dados Víssimo); sem permissão nelas, as consultas caem nas tabelas de origem (T_RAW), tratadas
   para dar o mesmo resultado (ver redshift-sources.js). Dá para trocar por variável de ambiente. */
const T = {
  fact: process.env.T_FACT_ORDER_ITEM || 'dora_red_aggregations.ev_fact_order_item',
  lc: process.env.T_LAST_CLICK || 'vissimo_bi.vw_ev_last_click_pedido',
  bundle: process.env.T_DIM_BUNDLE || 'dora_red_aggregations.vw_ev_dim_product_bundle',
  grupo: process.env.T_GRUPO_PRODUTO || 'dora_red_aggregations.vw_carga_ev_grupo_de_produto',
  produto: process.env.T_DIM_PRODUCT || 'dora_red_aggregations.ev_dim_product',
};
/* tabelas de origem, usadas só quando falta permissão na view acima */
const T_RAW = {
  lc: process.env.T_LAST_CLICK_RAW || 'dora_red_aggregations.ev_last_click_full',
  grupo: process.env.T_GRUPO_PRODUTO_RAW || 'dora_red_aggregations.ev_grupo_de_produto',
};
Object.values(T).concat(Object.values(T_RAW)).forEach((t) => { if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(t)) throw new Error('Nome de tabela inválido: ' + t); });

module.exports = { query, T, T_RAW };
