import { config } from './config.js';
import { getLead, extractClientData, writeResults } from './datacrazy.js';
import { getEnabledProviders } from './providers/index.js';
import { NeedsLoginError } from './providers/_browser.js';
 
const queue = [];
let running = false;
const needsLogin = {}; // { claro:true, ... } operadoras com sessão caída
 
export function loginStatus() { return { ...needsLogin }; }
 
export function enqueue(leadId) {
  queue.push({ leadId, tries: 0 });
  processNext();
}
 
async function processNext() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  try {
    await handle(job);
  } catch (e) {
    console.error(`[fluxo] erro no lead ${job.leadId}:`, e.message);
    if (job.tries < 2) { job.tries += 1; queue.push(job); }
  } finally {
    running = false;
    if (queue.length) processNext();
  }
}
 
async function handle(job) {
  const lead = await getLead(job.leadId);
  const cliente = extractClientData(lead);
 
  // DEBUG: estrutura do lead (p/ achar o id do campo "Claro Aprovado")
  try {
    console.log('[debug] lead top keys:', Object.keys(lead || {}).join(','));
    console.log('[debug] additionalFields:', JSON.stringify(lead?.additionalFields).slice(0, 2500));
    for (const k of ['customFields', 'fields', 'attributes', 'campos', 'camposAdicionais']) {
      if (lead && lead[k]) console.log(`[debug] ${k}:`, JSON.stringify(lead[k]).slice(0, 2500));
    }
  } catch (e) { console.log('[debug] erro ao logar lead:', e.message); }
 
  if (!cliente.cpf || cliente.cpf.length !== 11) {
    console.warn(`[fluxo] lead ${job.leadId} sem CPF válido ("${cliente.cpf}") — pulando.`);
    return;
  }
 
  const results = {};
  for (const provider of getEnabledProviders()) {
    try {
      console.log(`[fluxo] ${provider.name}: consultando lead ${job.leadId} (CPF ${mask(cliente.cpf)})`);
      const r = await provider.consultar(cliente);
      console.log(`[debug] ${provider.name} resultado bruto:`, (r.raw || '').slice(0, 700));
      if (r.inconclusivo) {
        console.warn(`[fluxo] ${provider.name}: resultado inconclusivo. Texto: ${r.raw?.slice(0, 160)}`);
        continue;
      }
      results[provider.key] = r.aprovado;
      needsLogin[provider.key] = false;
      console.log(`[fluxo] ${provider.name}: ${r.aprovado ? 'Aprovado' : 'Reprovado'}`);
    } catch (e) {
      if (e instanceof NeedsLoginError) {
        needsLogin[provider.key] = true;
        console.warn(`[fluxo] ${provider.name}: sessão caída — refaça "npm run login ${provider.key}".`);
      } else {
        console.error(`[fluxo] ${provider.name}: erro — ${e.message}`);
      }
    }
  }
 
  if (Object.keys(results).length) {
    await writeResults(job.leadId, results, lead);
    console.log(`[fluxo] lead ${job.leadId} gravado:`, results);
  } else {
    console.warn(`[fluxo] lead ${job.leadId}: nenhuma operadora retornou resultado.`);
  }
}
 
function mask(cpf) {
  return cpf.replace(/^(\d{3})\d{5}(\d{3})$/, '$1*****$2');
}
 
export function parseWebhook(body) {
  let leadId =
    body?.lead?.id || body?.data?.lead?.id || body?.leadId || body?.data?.id || body?.id;
  // limpa chaves/aspas/espaços que o template do CRM possa ter deixado (ex.: "{uuid}")
  if (leadId) leadId = String(leadId).replace(/[{}"'\s]/g, '').trim();
  const stageName =
    body?.stage?.name || body?.data?.stage?.name || body?.pipelineStage?.name ||
    body?.etapa || body?.data?.etapa || body?.stageName || '';
  return { leadId, stageName };
}
