import { config } from '../config.js';
import { openSession, loginAndSave, NeedsLoginError, parseAprovacao } from './_browser.js';
 
const C = config.claro;
 
// ISO/data -> dd/mm/aaaa
function formatBR(d) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const dt = new Date(s);
  if (isNaN(dt)) return s;
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}
 
async function ensureLoggedIn(page) {
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(90000);
  let ok = false;
  for (let i = 0; i < 2 && !ok; i++) {
    try {
      await page.goto(`${C.baseUrl}/vendas/viabilidade`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      ok = true;
    } catch (e) {
      if (i === 1) throw e;
      await page.waitForTimeout(2000);
    }
  }
  await page.waitForTimeout(3000);
  if (page.url().includes('/login')) {
    throw new NeedsLoginError('claro', 'Sessão do Claro expirada — acesse /admin, logue no Claro e clique no botão "Enviar sessão Claro".');
  }
}
 
/* ---------- helpers react-select / UI (via page.evaluate) ---------- */
 
async function waitId(page, id, timeout = 30000) {
  await page.waitForFunction((id) => !!document.getElementById(id), id, { timeout });
}
 
// Seleciona valor num react-select (abre pela seta; opcionalmente digita p/ filtrar).
async function pickRS(page, inputId, value, type = false) {
  if (!value) return;
  await waitId(page, inputId);
  const res = await page.evaluate(async ({ inputId, value, type }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    const inp = document.getElementById(inputId);
    if (!inp) return { ok: false, err: 'input inexistente' };
    const sel = inp.closest('.Select');
    const az = sel.querySelector('.Select-arrow-zone') || sel.querySelector('.Select-control');
    fire(az, 'mousedown'); fire(az, 'mouseup');
    await sleep(600);
    if (type) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1300);
    }
    const opts = [...document.querySelectorAll('.Select-menu-outer [role="gridcell"]')];
    const up = value.toUpperCase();
    let li = opts.find((e) => e.innerText.trim().toUpperCase() === up)
          || opts.find((e) => e.innerText.trim().toUpperCase().includes(up));
    if (!li) return { ok: false, avail: opts.map((e) => e.innerText.trim()).slice(0, 10) };
    fire(li, 'mousedown'); fire(li, 'mouseup'); fire(li, 'click');
    await sleep(500);
    return { ok: true };
  }, { inputId, value, type });
  if (!res || !res.ok) {
    throw new Error(`campo ${inputId}="${value}" não selecionado (opções: ${JSON.stringify(res && (res.avail || res.err))})`);
  }
}
 
// Seleciona a 1ª opção de um react-select (ex.: logradouros).
async function pickFirst(page, inputId) {
  await waitId(page, inputId);
  const res = await page.evaluate(async ({ inputId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    const inp = document.getElementById(inputId);
    const sel = inp.closest('.Select');
    const az = sel.querySelector('.Select-arrow-zone') || sel.querySelector('.Select-control');
    fire(az, 'mousedown'); fire(az, 'mouseup');
    await sleep(1400);
    const opts = [...document.querySelectorAll('.Select-menu-outer [role="gridcell"]')];
    if (!opts.length) return { ok: false };
    fire(opts[0], 'mousedown'); fire(opts[0], 'mouseup'); fire(opts[0], 'click');
    await sleep(500);
    return { ok: true, escolhido: opts[0].innerText.trim() };
  }, { inputId });
  if (!res || !res.ok) throw new Error(`logradouro (${inputId}) sem opções`);
}
 
// Preenche input de texto controlado (React).
async function setText(page, id, value) {
  await waitId(page, id);
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { id, value });
}
 
// Clica num botão pelo texto exato (ex.: "CONSULTAR") ou regex.
async function clickButtonText(page, matcher, { exact = false } = {}) {
  const res = await page.evaluate(({ matcher, exact }) => {
    const fire = (el, t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    const btns = [...document.querySelectorAll('button')];
    let b;
    if (exact) b = btns.find((x) => x.innerText.trim().toUpperCase() === matcher.toUpperCase());
    else b = btns.find((x) => new RegExp(matcher, 'i').test(x.innerText.trim()));
    if (!b) return { ok: false };
    fire(b, 'mousedown'); fire(b, 'mouseup'); fire(b, 'click');
    return { ok: true };
  }, { matcher, exact });
  return res && res.ok;
}
 
async function clickAvancar(page) {
  const ok = await clickButtonText(page, 'avan');
  if (!ok) throw new Error('botão AVANÇAR não encontrado');
  await page.waitForTimeout(3500);
}
 
async function dismissPopup(page) {
  try { await clickButtonText(page, 'OK', { exact: true }); await page.waitForTimeout(600); } catch {}
}
 
/* ---------- fluxo completo ---------- */
 
async function fillAddressAndOpenCredit(page) {
  const e = C.endereco;
  // Passo 1: endereço inicial
  await pickRS(page, 'input-empresa', e.tipoServico);        // COM CABO
  await pickRS(page, 'input-estado', e.estado, true);        // RIO DE JANEIRO
  await pickRS(page, 'input-cidade', e.cidade, true);        // RIO DE JANEIRO
  await pickRS(page, 'input-tipoPesquisa', 'CEP');
  await setText(page, 'cep', e.cep);                         // 22790-410
  await page.waitForTimeout(800);
  await clickAvancar(page);
 
  // Passo 2: logradouro + número
  await pickFirst(page, 'input-logradouros');
  await setText(page, 'numeroInicial', e.numero);            // 40
  await setText(page, 'numeroFinal', e.numero);
  await page.waitForTimeout(500);
  await clickAvancar(page);
 
  // Passo 3: seleciona o 1º apartamento (radio)
  await page.waitForFunction(() => document.querySelector('table tbody tr input[type="radio"]'), null, { timeout: 30000 });
  await page.evaluate(() => { const r = document.querySelector('table tbody tr input[type="radio"]'); if (r) r.click(); });
  await page.waitForTimeout(600);
  await clickAvancar(page);
 
  // Passo 4: abre o modal de crédito
  await dismissPopup(page);
  const ok = await clickButtonText(page, 'consultar\\s*cr[ée]dito');
  if (!ok) throw new Error('botão CONSULTAR CRÉDITO não encontrado');
  await waitId(page, 'input-tipoCliente', 20000);
  await page.waitForTimeout(500);
}
 
async function runCreditQuery(page, cliente) {
  // Formulário do modal de crédito.
  await pickRS(page, 'input-tipoCliente', C.credito.tipoCliente);   // RESIDENCIAL
  await pickRS(page, 'input-tipoVenda', C.credito.tipoVenda);       // PROSPECT
  await pickRS(page, 'input-empresa', C.endereco.tipoServico);      // COM CABO
  await pickRS(page, 'input-tipoConsulta', C.credito.tipoConsulta); // CPF
  await pickRS(page, 'input-uf', C.endereco.estado, true);          // RIO DE JANEIRO
  await pickRS(page, 'input-cidade', C.endereco.cidade, true);      // RIO DE JANEIRO
 
  if (cliente.nome) await setText(page, 'nome', cliente.nome);
  await waitId(page, 'cpfCnpj');
  await setText(page, 'cpfCnpj', cliente.cpf);
  if (cliente.nascimento) {
    try { await setText(page, 'nascimento', formatBR(cliente.nascimento)); } catch {}
  }
 
  await page.waitForTimeout(400);
  const ok = await clickButtonText(page, 'consultar', { exact: true }); // "CONSULTAR" (não "CONSULTAR CRÉDITO")
  if (!ok) throw new Error('botão CONSULTAR não encontrado');
  await page.waitForTimeout(9000);
 
  const raw = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
  return parseAprovacao(raw);
}
 
export const claro = {
  key: 'claro',
  name: 'Claro Conexão',
  resultFieldId: () => config.datacrazy.results.claro,
  loginUrl: C.loginUrl,
  storageState: C.storageState,
 
  async loginInteractive() {
    await loginAndSave({
      loginUrl: C.loginUrl,
      storageState: C.storageState,
      successWhen: (url) => !url.toString().includes('/login'),
    });
  },
 
  async consultar(cliente) {
    const { browser, context, page } = await openSession('claro', C.storageState);
    try {
      await ensureLoggedIn(page);
      await fillAddressAndOpenCredit(page);
      const r = await runCreditQuery(page, cliente);
      await context.storageState({ path: C.storageState });
      return r;
    } finally {
      await browser.close();
    }
  },
};
