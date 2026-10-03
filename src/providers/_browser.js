// Helpers compartilhados de automação (Playwright) para todas as operadoras.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export class NeedsLoginError extends Error {
  constructor(provider, msg) {
    super(msg || `Sessão da operadora "${provider}" expirada — rode: npm run login ${provider}`);
    this.name = 'NeedsLoginError';
    this.code = 'NEEDS_LOGIN';
    this.provider = provider;
  }
}

/** Abre um contexto reaproveitando a sessão salva. Lança NeedsLoginError se não há sessão. */
export async function openSession(provider, storageState) {
  if (!fs.existsSync(storageState)) throw new NeedsLoginError(provider, `Nenhuma sessão salva. Rode: npm run login ${provider}`);
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  return { browser, context, page };
}

/** Login manual (navegador visível) e salva a sessão. */
export async function loginAndSave({ loginUrl, storageState, successWhen }) {
  fs.mkdirSync(path.dirname(storageState), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(loginUrl);
  console.log('\n>>> Faça o login na janela que abriu. A sessão será salva ao concluir.\n');
  await page.waitForURL(successWhen, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await context.storageState({ path: storageState });
  console.log(`Sessão salva em ${storageState}`);
  await browser.close();
}

/* ----- helpers de UI (Material UI) ----- */
export async function pickAutocomplete(page, inputId, value) {
  const input = page.locator(`#${inputId}`);
  await input.click();
  await input.fill('');
  await input.type(value, { delay: 20 });
  const option = page.locator('[role="option"]', { hasText: value }).first();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click();
}

export async function pickSelect(page, inputId, value) {
  await page.locator(`#${inputId}`).click();
  const option = page.locator('[role="option"]', { hasText: value }).first();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click();
}

export async function clickButton(page, text) {
  await page.getByRole('button', { name: new RegExp(text, 'i') }).first().click();
}

/** Interpreta texto de resultado em aprovado/reprovado/inconclusivo. */
export function parseAprovacao(raw) {
  const reprovado = /(reprovad|negad|recusad|restri|pendente|não aprovad|nao aprovad)/i.test(raw);
  const aprovado = /(aprovad|liberad|positiv|sem restri)/i.test(raw) && !reprovado;
  if (!aprovado && !reprovado) return { aprovado: null, raw, inconclusivo: true };
  return { aprovado: !!aprovado, raw };
}
