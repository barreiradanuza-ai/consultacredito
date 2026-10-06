import { config } from '../config.js';
import {
  openSession, loginAndSave, NeedsLoginError,
  pickAutocomplete, pickSelect, clickButton, parseAprovacao,
} from './_browser.js';
 
const C = config.claro;
 
async function dismissFibraPopup(page) {
  try {
    const ok = page.getByRole('button', { name: /^ok$/i });
    if (await ok.isVisible({ timeout: 3000 })) await ok.click();
  } catch { /* sem popup */ }
}
 
// Login headless com e-mail/senha (seletores resilientes; ajuste se o portal mudar).
async function doLogin(page) {
  if (!C.email || !C.senha) {
    throw new NeedsLoginError('claro', 'Defina CLARO_EMAIL e CLARO_SENHA (ou suba uma sessão) para o autologin.');
  }
  await page.goto(C.loginUrl, { waitUntil: 'domcontentloaded' });
  const email = page.locator('input[type="email"], input[name="email"], #email').first();
  const senha = page.locator('input[type="password"], input[name="senha"], #senha, #password').first();
  await email.waitFor({ timeout: 15000 });
  await email.fill(C.email);
  await senha.fill(C.senha);
  await page.getByRole('button', { name: /entrar|fazer login|login|acessar/i }).first().click();
  // espera sair da tela de login
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 30000 });
  await page.waitForTimeout(1500);
}
 
async function ensureLoggedIn(page) {
  await page.goto(`${C.baseUrl}/vendas/viabilidade`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // Com sessão reaproveitada não tentamos autologin (o Claro tem reCAPTCHA).
  // Se caiu na tela de login, a sessão expirou: a usuária precisa relogar e reenviar pelo /admin.
  if (page.url().includes('/login')) {
    throw new NeedsLoginError('claro', 'Sessão do Claro expirada — acesse /admin, logue no Claro e clique no botão "Enviar sessão Claro".');
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
 
async function runCreditQuery(page, cliente) {
  await dismissFibraPopup(page);
  await page.getByRole('button', { name: /consultar crédito/i }).click();
 
  const dialog = page.locator('[role="dialog"], .MuiDialog-paper').last();
  await dialog.locator('#input-tipoConsulta').waitFor({ timeout: 15000 });
 
  if (C.credito.tipoCliente) await pickSelect(page, 'input-tipoCliente', C.credito.tipoCliente);
  if (C.credito.tipoVenda) await pickSelect(page, 'input-tipoVenda', C.credito.tipoVenda);
  await pickSelect(page, 'input-tipoConsulta', C.credito.tipoConsulta);
 
  const cpfField = dialog.locator('#cpf');
  if (await cpfField.count()) await cpfField.fill(cliente.cpf);
  else await dialog.locator('#nome').fill(cliente.nome);
 
  await dialog.getByRole('button', { name: /consultar/i }).click();
  await page.waitForTimeout(6000);
  const raw = (await dialog.innerText()).replace(/\s+/g, ' ').trim();
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
      await fillAddress(page);
      const r = await runCreditQuery(page, cliente);
      await context.storageState({ path: C.storageState }); // renova cookies
      return r;
    } finally {
      await browser.close();
    }
  },
};
