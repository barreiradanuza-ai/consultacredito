import { config } from './config.js';
import { getLead, buildCliente, writeResults } from './datacrazy.js';
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
  const cliente = await buildCliente(job.leadId, lead); // nativos + campos adicionais
  console.log(`[fluxo] cliente: nome="${cliente.nome}" cpf=${cliente.cpf ? cliente.cpf.length + ' díg' : 'vazio'} nasc=${cliente.nascimento ? 'ok' : 'vazio'}`);
 
  if (!cliente.cpf || cliente.cpf.length !== 11) {
    console.warn(`[fluxo] lead ${job.leadId} sem CPF válido ("${cliente.cpf}") — pulando.`);
    return;
  }
