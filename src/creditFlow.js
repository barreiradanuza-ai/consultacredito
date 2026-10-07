import { config } from './config.js';
import { getLead, buildCliente, writeResults } from './datacrazy.js';
import { getEnabledProviders } from './providers/index.js';
import { NeedsLoginError } from './providers/_browser.js';

const queue = [];
let running = false;
const needsLogin = {}; // { claro:true, ... } operadoras com sessão caída
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const cliente = await buildCliente(job.leadId, lead); // nativos + campos adicionais
  console.log(`[fluxo] cliente: nome="${cliente.nome}" cpf=${cliente.cpf ? cliente.cpf.length + ' díg' : 'vazio'} nasc=${cliente.nascimento ? 'ok' : 'vazio'}`);

  if (!cliente.cpf || cliente.cpf.length !== 11) {
    console.warn(`[fluxo] lead ${job.leadId} sem CPF válido ("${cliente.cpf}") — pulando.`);
    return;
  }

  const results = {};
  const MAX_TENTATIVAS = 3;
  for (const provider of getEnabledProviders()) {
    let r = null;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS && !r; tentativa++) {
      try {
        console.log(`[fluxo] ${provider.name}: consultando lead ${job.leadId} (CPF ${mask(cliente.cpf)}) — tentativa ${tentativa}`);
        const res = await provider.consultar(cliente);
        if (res.inconclusivo) {
          console.warn(`[fluxo] ${provider.name}: inconclusivo (tent. ${tentativa}). Texto: ${res.raw?.slice(0, 160)}`);
          // inconclusivo com nascimento ausente é definitivo; senão tenta de novo
          if (!cliente.nascimento || tentativa === MAX_TENTATIVAS) break;
          await sleep(2500);
          continue;
        }
        r = res;
      } catch (e) {
        if (e instanceof NeedsLoginError) {
          needsLogin[provider.key] = true;
          console.warn(`[fluxo] ${provider.name}: sessão caída — relogue pelo /admin.`);
          break;
        }
        console.error(`[fluxo] ${provider.name}: erro tent. ${tentativa} — ${e.message}`);
        if (tentativa < MAX_TENTATIVAS) await sleep(2500);
      }
    }
    if (r) {
      results[provider.key] = r.aprovado;
      needsLogin[provider.key] = false;
      console.log(`[fluxo] ${provider.name}: ${r.aprovado ? 'Aprovado' : 'Reprovado'}`);
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
