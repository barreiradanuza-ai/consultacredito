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

export async function getLead(id) {
  return api(`/api/v1/leads/${encodeURIComponent(id)}?complete=true`);
}

function flattenFields(lead) {
  const af = lead?.additionalFields;
  if (!af) return [];
  if (Array.isArray(af)) return af;
  return Object.entries(af).map(([k, v]) => {
    if (v && typeof v === 'object') return { id: v.id || k, name: v.name || k, value: v.value };
    return { id: k, name: k, value: v };
  });
}

const norm = (s) => String(s || '').trim().toLowerCase();

export function getAdditionalField(lead, nameOrId) {
  const found = flattenFields(lead).find((f) => f.id === nameOrId || norm(f.name) === norm(nameOrId));
  return found?.value;
}

export function extractClientData(lead) {
  const f = config.datacrazy.fields;
  const data = {
    nome: getAdditionalField(lead, f.nome) || lead?.name || '',
    cpf: String(getAdditionalField(lead, f.cpf) || '').replace(/\D/g, ''),
    nascimento: getAdditionalField(lead, f.nascimento) || '',
  };
  if (!data.cpf) {
    console.log('[datacrazy] RAW chaves:', JSON.stringify(Object.keys(lead || {})));
    console.log('[datacrazy] RAW lead:', JSON.stringify(lead).slice(0, 2000));
  }
  return data;
}

export function resolveFieldId(lead, nameOrId) {
  const found = flattenFields(lead).find((f) => f.id === nameOrId || norm(f.name) === norm(nameOrId));
  return found?.id || nameOrId;
}

export async function writeResults(leadId, results, lead) {
  const map = config.datacrazy.results;
  const additionalFields = [];
  for (const [key, aprovado] of Object.entries(results)) {
    if (aprovado === null || aprovado === undefined) continue;
    const nameOrId = map[key];
    if (!nameOrId) continue;
    additionalFields.push({ id: resolveFieldId(lead, nameOrId), value: aprovado ? 'Sim' : 'Não' });
  }
  if (!additionalFields.length) return null;
  return api(`/api/v1/leads/${encodeURIComponent(leadId)}`, { method: 'PATCH', body: { additionalFields } });
}
