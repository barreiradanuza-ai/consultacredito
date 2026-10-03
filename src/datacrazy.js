import { config } from './config.js';

const { baseUrl, token } = config.datacrazy;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === 'object' ? JSON.stringify(data) : data;
    throw new Error(`DataCrazy ${method} ${path} -> ${res.status}: ${msg}`);
  }
  return data;
}

/** GET /api/v1/leads/{id}?complete=true */
export async function getLead(id) {
  return api(`/api/v1/leads/${encodeURIComponent(id)}?complete=true`);
}

export function getAdditionalField(lead, fieldId) {
  const af = lead?.additionalFields;
  if (!af) return undefined;
  const list = Array.isArray(af) ? af : [af];
  const found = list.find((f) => f.id === fieldId || f.name === fieldId);
  return found?.value;
}

/** Extrai nome, cpf (só dígitos) e nascimento do lead. */
export function extractClientData(lead) {
  const f = config.datacrazy.fields;
  return {
    nome: getAdditionalField(lead, f.nome) || lead?.name || '',
    cpf: String(getAdditionalField(lead, f.cpf) || '').replace(/\D/g, ''),
    nascimento: getAdditionalField(lead, f.nascimento) || '',
  };
}

/**
 * Grava os resultados por operadora.
 * results: { claro: true|false, tim: true|false, ... } (só as que rodaram)
 * PATCH /api/v1/leads/{id}  com additionalFields = [{id, value:"Sim"|"Não"}]
 */
export async function writeResults(leadId, results) {
  const map = config.datacrazy.results;
  const additionalFields = [];
  for (const [key, aprovado] of Object.entries(results)) {
    if (aprovado === null || aprovado === undefined) continue;
    const fieldId = map[key];
    if (!fieldId) { console.warn(`[datacrazy] sem FIELD_ID para "${key}", pulando gravação.`); continue; }
    additionalFields.push({ id: fieldId, value: aprovado ? 'Sim' : 'Não' });
  }
  if (!additionalFields.length) return null;
  return api(`/api/v1/leads/${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    body: { additionalFields },
  });
}
