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
 
async function dismissFibraPopup(page) {
  try {
    const ok = page.getByRole('button', { name: /^ok$/i });
    if (await ok.isVisible({ timeout: 2500 })) await ok.click();
  } catch { /* sem popup */ }
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
  // Com sessão reaproveitada não tentamos autologin (o Claro tem reCAPTCHA).
  if (page.url().includes('/login')) {
    throw new NeedsLoginError('claro', 'Sessão do Claro expirada — acesse /admin, logue no Claro e clique no botão "Enviar sessão Claro".');
  }
}
 
/**
 * Seleciona um valor num campo react-select (lista virtualizada).
 * Abre pela "seta", opcionalmente digita p/ filtrar, e clica no <li role="gridcell">.
 */
async function pickRS(page, inputId, value, type = false) {
  if (!value) return;
  const res = await page.evaluate(async ({ inputId, value, type }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    const inp = document.getElementById(inputId);
    if (!inp) return { ok: false, err: 'input inexistente' };
    const sel = inp.closest('.Select');
    const az = sel.querySelector('.Select-arrow-zone') || sel.querySelector('.Select-control');
    fire(az, 'mousedown'); fire(az, 'mouseup');
    await sleep(500);
    if (type) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1100);
    }
    const opts = [...document.querySelectorAll('.Select-menu-outer [role="gridcell"]')];
    const up = value.toUpperCase();
    let li = opts.find((e) => e.innerText.trim().toUpperCase() === up)
          || opts.find((e) => e.innerText.trim().toUpperCase().includes(up));
    if (!li) return { ok: false, avail: opts.map((e) => e.innerText.trim()).slice(0, 10) };
    fire(li, 'mousedown'); fire(li, 'mouseup'); fire(li, 'click');
    await sleep(450);
    return { ok: true };
  }, { inputId, value, type });
  if (!res || !res.ok) {
    throw new Error(`campo ${inputId}="${value}" não selecionado (opções: ${JSON.stringify(res && res.avail || res && res.err)})`);
  }
}
 
// Preenche input de texto controlado (React) + dispara os eventos.
async function setText(page, id, value) {
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
 
async function runCreditQuery(page, cliente) {
  await dismissFibraPopup(page);
 
  // Garante o formulário de Consultar Crédito na tela.
  try {
    await page.waitForSelector('#input-tipoCliente', { timeout: 10000 });
  } catch {
    // tenta abrir pelo botão, se o formulário não estiver visível
    try { await page.getByRole('button', { name: /consultar crédito/i }).first().click(); } catch {}
    await page.waitForSelector('#input-tipoCliente', { timeout: 15000 });
  }
 
  // Selects (react-select). uf/cidade filtram ao digitar (type=true).
  await pickRS(page, 'input-tipoCliente', C.credito.tipoCliente);   // RESIDENCIAL
  await pickRS(page, 'input-tipoVenda',   C.credito.tipoVenda);      // PROSPECT
  await pickRS(page, 'input-empresa',     C.endereco.tipoServico);   // COM CABO
  await pickRS(page, 'input-tipoConsulta', C.credito.tipoConsulta);  // CPF
  await pickRS(page, 'input-uf',     C.endereco.estado, true);       // RIO DE JANEIRO
  await pickRS(page, 'input-cidade', C.endereco.cidade, true);       // RIO DE JANEIRO
 
  // Campos de texto.
  if (cliente.nome) await setText(page, 'nome', cliente.nome);
  // CPF com máscara: digita dígito a dígito p/ a máscara formatar.
  const cpfField = page.locator('#cpfCnpj');
  await cpfField.click();
  await cpfField.fill('');
  await cpfField.type(cliente.cpf, { delay: 40 });
  if (cliente.nascimento) {
    const nasc = page.locator('#nascimento');
    await nasc.click();
    await nasc.fill('');
    await nasc.type(formatBR(cliente.nascimento), { delay: 40 });
  }
 
  // Envia (botão "CONSULTAR", não "CONSULTAR CRÉDITO").
  await page.getByRole('button', { name: /^\s*consultar\s*$/i }).first().click();
  await page.waitForTimeout(8000);
 
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
      const r = await runCreditQuery(page, cliente);
      await context.storageState({ path: C.storageState }); // renova cookies
      return r;
    } finally {
      await browser.close();
    }
  },
};
 
