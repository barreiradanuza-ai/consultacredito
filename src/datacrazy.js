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

/** Extrai nome, cpf (só dígitos) e nascimento do lead. Prioriza campos NATIVOS. */
export function extractClientData(lead) {
  const f = config.datacrazy.fields;
  return {
    nome: lead?.name || getAdditionalField(lead, f.nome) || '',
    cpf: String(lead?.taxId || getAdditionalField(lead, f.cpf) || '').replace(/\D/g, ''),
    nascimento: lead?.birthDate || getAdditionalField(lead, f.nascimento) || '',
  };
}

/** Lê os CAMPOS ADICIONAIS do lead (que NÃO vêm no GET do lead) → mapa {nomeDoCampo: valor}. */
export async function getLeadAdditionalFields(leadId) {
  try {
    const data = await api(`/api/v1/crm/additional-fields/lead/${encodeURIComponent(leadId)}`);
    const list = Array.isArray(data?.data) ? data.data : [];
    const map = {};
    for (const it of list) {
      const name = it?.additionalField?.name;
      const val = it?.value ?? it?.valueString ?? it?.valueNumber ?? it?.valueDate;
      if (name && val != null && String(val) !== '') map[name] = val;
    }
    return map;
  } catch (e) {
    console.warn('[datacrazy] falha ao ler campos adicionais do lead:', e.message);
    return {};
  }
}

/**
 * Monta os dados do cliente combinando campos NATIVOS + CAMPOS ADICIONAIS.
 * Alguns leads têm CPF/Nome/Nascimento só nos campos adicionais (ex.: "Data de Nascimento").
 */
export async function buildCliente(leadId, lead) {
  const f = config.datacrazy.fields;
  const add = await getLeadAdditionalFields(leadId);
  const first = (cands) => { for (const n of cands) { if (n && add[n] != null && String(add[n]) !== '') return add[n]; } return ''; };
  const nome = lead?.name || first([f.nome, 'Nome Lead', 'Nome']);
  const cpf = String(lead?.taxId || first([f.cpf, 'CPF Lead', 'CPF'])).replace(/\D/g, '');
  const nascimento = lead?.birthDate || first([f.nascimento, 'Data de Nascimento', 'Nascimento Lead', 'Nascimento']);
  const mae = first(['Mãe Lead', 'Mae Lead', 'Nome da Mãe', 'Nome da Mae', 'Mãe', 'Mae']);
  return { nome, cpf, nascimento, mae };
}

/** Resolve o ID real de um campo a partir do nome (ou do próprio id), lendo o lead. */
export function resolveFieldId(lead, nameOrId) {
  const af = lead?.additionalFields;
  if (!af || !nameOrId) return nameOrId;
  const list = Array.isArray(af) ? af : [af];
  const found = list.find((f) => f.id === nameOrId || f.name === nameOrId);
  return found?.id || nameOrId;
}

/** Descobre o id do NEGÓCIO (business) ligado ao lead (os campos "Claro Aprovado" são do negócio). */
export async function getBusinessId(leadId) {
  const data = await api(`/api/v1/leads/${encodeURIComponent(leadId)}/businesses`);
  const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  if (!list.length) return null;
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list[0]?.id || null;
}

/**
 * Grava os resultados por operadora no NEGÓCIO do lead.
 * results: { claro: true|false, tim: ..., nio: ... } (só as que rodaram)
 * config.datacrazy.results[key] = ID (UUID) do campo adicional do negócio.
 * PUT /api/v1/crm/additional-fields/business/{businessId}/{fieldId}  body { value: "Sim"|"Não" }
 */
export async function writeResults(leadId, results, _lead) {
  const map = config.datacrazy.results;
  const businessId = await getBusinessId(leadId);
  if (!businessId) {
    console.warn(`[datacrazy] lead ${leadId} sem negócio associado — não há onde gravar.`);
    return null;
  }
  const gravados = {};
  for (const [key, aprovado] of Object.entries(results)) {
    if (aprovado === null || aprovado === undefined) continue;
    const fieldId = map[key];
    if (!fieldId) { console.warn(`[datacrazy] sem id de campo p/ "${key}", pulando.`); continue; }
    const value = aprovado ? 'Sim' : 'Não';
    await api(`/api/v1/crm/additional-fields/business/${encodeURIComponent(businessId)}/${encodeURIComponent(fieldId)}`, {
      method: 'PUT',
      body: { value },
    });
    gravados[key] = value;
    console.log(`[datacrazy] negócio ${businessId}: ${key} = ${value}`);
  }
  return { businessId, gravados };
}
