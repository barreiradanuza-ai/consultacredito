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
