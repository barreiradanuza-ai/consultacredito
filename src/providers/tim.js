import { chromium } from 'playwright';
import fs from 'node:fs';
import { config } from '../config.js';
import { loginAndSave, NeedsLoginError } from './_browser.js';

const TIM_URL = 'https://apptimvendas.timbrasil.com.br/';
const TIM_STORAGE = process.env.TIM_STORAGE_STATE || '/data/tim-session.json';
const MATRICULA = process.env.TIM_MATRICULA || 'T3769890';
const CEP = process.env.TIM_CEP || '22790-400';
const NUMERO = process.env.TIM_NUMERO || '60';

function formatBR(d) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const dt = new Date(s);
  if (isNaN(dt)) return s;
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getUTCFullYear()}`;
}

/** Abre o TIM headless e injeta a sessão (tokens no IndexedDB). */
async function openTim() {
  const browser = await chromium.launch({ headless: config.headless, args: ['--no-sandbox'] });
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(90000);
  await page.goto(TIM_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(6000); // Imperva + cria IndexedDB
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(TIM_STORAGE, 'utf8')); }
  catch { await browser.close(); throw new NeedsLoginError('tim', 'Sem sessão do TIM — abra /admin e envie a sessão do TIM.'); }
  await page.evaluate(async (idb) => {
    await new Promise((resolve) => {
      const open = indexedDB.open('_ionicstorage');
      open.onupgradeneeded = () => { try { open.result.createObjectStore('_ionickv'); } catch (e) {} };
      open.onsuccess = () => {
        const db = open.result;
        let store;
        try { store = db.transaction('_ionickv', 'readwrite').objectStore('_ionickv'); } catch (e) { return resolve(); }
        for (const k in idb) { try { store.put(idb[k], k); } catch (e) {} }
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => resolve();
      };
      open.onerror = () => resolve();
    });
  }, bundle.idb || {});
  await page.goto(TIM_URL + '#/home', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);
  if (page.url().includes('/login')) {
    await browser.close();
    throw new NeedsLoginError('tim', 'Sessão do TIM expirada — abra /admin e envie a sessão do TIM de novo.');
  }
  return { browser, context, page };
}

// A página ATIVA do Ionic (as páginas anteriores ficam no DOM como .ion-page-hidden).
function activePage(page) {
  return page.locator('.ion-page:not(.ion-page-hidden)').last();
}
async function clickText(page, text) {
  const loc = page.getByText(text, { exact: true }).filter({ visible: true });
  await loc.first().click({ timeout: 30000 });
}
async function clickBtn(page, re) {
  const loc = page.locator('button, ion-button, [ion-button]').filter({ hasText: re }).filter({ visible: true });
  await loc.first().click({ timeout: 30000 });
}
async function inputLoc(page, placeholder) {
  return page.locator(`input[placeholder="${placeholder}"]`).filter({ visible: true }).first();
}
async function typeInto(page, placeholder, value) {
  const el = await inputLoc(page, placeholder);
  await el.click();
  await el.fill('');
  await el.pressSequentially(String(value), { delay: 40 });
}
async function fillText(page, placeholder, value) {
  const el = await inputLoc(page, placeholder);
  await el.fill(String(value));
}
async function valueOf(page, placeholder) {
  try { return await (await inputLoc(page, placeholder)).inputValue(); } catch { return ''; }
}
async function waitHash(page, part) {
  await page.waitForFunction((p) => location.hash.includes(p), part, { timeout: 40000 });
}

async function runConsulta(page, cliente) {
  // 1. Novo Atendimento
  await clickText(page, 'Novo Atendimento');
  await waitHash(page, 'seller-selection');
  await page.waitForTimeout(1500);

  // 2. Seleção do vendedor (matrícula já vem preenchida)
  const matPh = 'Número da matrícula do(a) Vendedor(a)';
  if (!(await valueOf(page, matPh))) await typeInto(page, matPh, MATRICULA);
  try { await clickBtn(page, /buscar/i); await page.waitForTimeout(2500); } catch {}
  await clickBtn(page, /pr[oó]ximo/i);
  await waitHash(page, 'installation-address');
  await page.waitForTimeout(1500);

  // 3. Endereço (CEP fixo + número) → Buscar preenche o resto
  await typeInto(page, 'CEP do cliente', CEP);
  await typeInto(page, 'Número logradouro do cliente', NUMERO);
  try { await clickBtn(page, /buscar/i); await page.waitForTimeout(3500); } catch {}
  await clickBtn(page, /pr[oó]ximo/i);
  await waitHash(page, 'client-identification');
  await page.waitForTimeout(1500);

  // 4. CPF
  await typeInto(page, 'CPF/CNPJ do Cliente', cliente.cpf);
  await clickBtn(page, /pr[oó]ximo/i);
  await waitHash(page, 'base-customer-data-pf');
  await page.waitForTimeout(3000); // auto-preenchimento pelo CPF

  // 5. Preenche o que vier vazio (nome/nascimento/mãe) com os dados do CRM
  if (cliente.nome && !(await valueOf(page, 'Informe o Nome Completo*'))) await fillText(page, 'Informe o Nome Completo*', cliente.nome);
  if (cliente.nascimento && !(await valueOf(page, 'Informe a Data de Nascimento*'))) await typeInto(page, 'Informe a Data de Nascimento*', formatBR(cliente.nascimento));
  if (cliente.mae && !(await valueOf(page, 'Informe o Nome da Mãe*'))) await fillText(page, 'Informe o Nome da Mãe*', cliente.mae);
  await page.waitForTimeout(600);
  await clickBtn(page, /pr[oó]ximo/i);

  // 6. Resultado: planos (#/offers-available) = Aprovado ; popup "Alçada de Score" = Reprovado
  await page.waitForTimeout(9000);
  const r = await page.evaluate(() => {
    const url = location.href;
    const txt = (document.body.innerText || '');
    const popup = /al[çc]ada de score/i.test(txt) || (/aten[çc][aã]o/i.test(txt) && /reserva do cliente/i.test(txt));
    const planos = url.includes('offers-available') || /TIM Fibra/i.test(txt);
    return { url, popup, planos, txt: txt.replace(/\s+/g, ' ').slice(0, 300) };
  });
  if (r.popup) return { aprovado: false, raw: `REPROVADO (popup alçada): ${r.txt}`, inconclusivo: false };
  if (r.planos) return { aprovado: true, raw: `APROVADO (offers): ${r.txt}`, inconclusivo: false };
  return { aprovado: null, raw: `inconclusivo url=${r.url} ${r.txt}`, inconclusivo: true };
}

export const tim = {
  key: 'tim',
  name: 'TIM',
  resultFieldId: () => config.datacrazy.results.tim,
  loginUrl: config.tim.loginUrl,
  storageState: TIM_STORAGE,

  async loginInteractive() {
    await loginAndSave({
      loginUrl: TIM_URL + '#/login',
      storageState: TIM_STORAGE,
      successWhen: (url) => !url.toString().includes('/login'),
    });
  },

  async consultar(cliente) {
    const { browser, page } = await openTim();
    try {
      return await runConsulta(page, cliente);
    } finally {
      await browser.close();
    }
  },
};
