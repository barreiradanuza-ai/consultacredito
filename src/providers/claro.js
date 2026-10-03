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

async function ensureLoggedIn(page) {
  await page.goto(`${C.baseUrl}/vendas/viabilidade`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) throw new NeedsLoginError('claro');
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
