import { config } from '../config.js';
import {
  openSession, loginAndSave, NeedsLoginError,
  pickAutocomplete, pickSelect, clickButton,
} from './_browser.js';

const C = config.claro;

async function dismissFibraPopup(page) {
  try {
    const ok = page.getByRole('button', { name: /^ok$/i });
    if (await ok.isVisible({ timeout: 3000 })) await ok.click();
  } catch { /* sem popup */ }
}

async function doLogin(page) {
  if (!C.email || !C.senha) {
    throw new NeedsLoginError('claro', 'Defina CLARO_EMAIL e CLARO_SENHA para o autologin.');
  }
  await page.goto(C.loginUrl, { waitUntil: 'domcontentloaded' });
  const email = page.locator('input[type="email"], input[name="email"], #email').first();
  const senha = page.locator('input[type="password"], input[name="senha"], #senha, #password').first();
  await email.waitFor({ timeout: 15000 });
  await email.fill(C.email);
  await senha.fill(C.senha);
  await page.getByRole('button', { name: /entrar|fazer login|login|acessar/i }).first().click();
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function ensureLoggedIn(page) {
  await page.goto(`${C.baseUrl}/vendas/viabilidade`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) {
    await doLogin(page);
    await page.goto(`${C.baseUrl}/vendas/viabilidade`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    if (page.url().includes('/login')) throw new NeedsLoginError('claro', 'Autologin falhou.');
  }
}

async function fillAddress(page) {
  const e = C.endereco;
  await pickAutocomplete(page, 'input-empresa', e.tipoServico);
  await pickAutocomplete(page, 'input-estado', e.estado);
  await pickAutocomplete(page, 'input-cidade', e.cidade);
  await pickSelect(page, 'input-tipoPesquisa', 'CEP');
  await page.locator('#cep').fill(e.cep);
  await clickButton(page, 'AVANÇAR');

  const log = page.locator('#input-logradouros');
  await log.click();
  const firstStreet = page.locator('[role="option"]').first();
  await firstStreet.waitFor({ state: 'visible', timeout: 10000 });
  await firstStreet.click();
  await page.locator('#numeroInicial').fill(e.numero);
  await page.locator('#numeroFinal').fill(e.numero);
  await clickButton(page, 'AVANÇAR');

  const firstRadio = page.locator('table tbody tr input[type="radio"]').first();
  await firstRadio.waitFor({ state: 'visible', timeout: 10000 });
  await firstRadio.check();
  await clickButton(page, 'AVANÇAR');

  await page.getByRole('button', { name: /consultar crédito/i }).waitFor({ timeout: 15000 });
  await dismissFibraPopup(page);
}

// Lê o campo "Status:" do resultado. Regra: Sim só se Status = CONSULTA APROVADA.
function parseClaroResult(raw) {
  const m = raw.match(/Status:\s*([^\n]+)/i);
  const status = (m ? m[1] : '').trim();
  if (/n[ãa]o\s+aprovad|reprovad|negad|recusad/i.test(status)) return { aprovado: false, raw, status };
  if (/aprovad|liberad/i.test(status)) return { aprovado: true, raw, status };
  return { aprovado: null, inconclusivo: true, raw, status };
}

async function runCreditQuery(page, cliente) {
  await dismissFibraPopup(page);
  await page.getByRole('button', { name: /consultar crédito/i }).click();

  const dialog = page.locator('[role="dialog"], .MuiDialog-paper').last();
  await dialog.locator('#input-tipoConsulta').waitFor({ timeout: 15000 });

  await pickSelect(page, 'input-tipoCliente', C.credito.tipoCliente || 'RESIDENCIAL');
  await pickSelect(page, 'input-tipoVenda', C.credito.tipoVenda || 'PROSPECT');
  await pickSelect(page, 'input-empresa', C.endereco.tipoServico); // Tipo de Serviço (COM CABO)
  await pickSelect(page, 'input-tipoConsulta', 'CPF');
  await pickAutocomplete(page, 'input-uf', C.endereco.estado);
  await pickAutocomplete(page, 'input-cidade', C.endereco.cidade);

  await dialog.locator('#nome').fill(cliente.nome);
  await dialog.locator('#cpfCnpj').fill(cliente.cpf);
  if (cliente.nascimento) await dialog.locator('#nascimento').fill(formatBR(cliente.nascimento));

  await dialog.getByRole('button', { name: /^consultar$/i }).click();
  await page.waitForTimeout(8000);
  const raw = (await dialog.innerText()).replace(/\r/g, '').trim();
  return parseClaroResult(raw);
}

// Garante data no formato dd/mm/aaaa (aceita 1997-06-13 ou já dd/mm/aaaa)
function formatBR(d) {
  const s = String(d).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s;
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
      await fillAddress(page);
      const r = await runCreditQuery(page, cliente);
      await context.storageState({ path: C.storageState });
      return r;
    } finally {
      await browser.close();
    }
  },
};
