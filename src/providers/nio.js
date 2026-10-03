import { config } from '../config.js';
import { loginAndSave } from './_browser.js';

// TODO: implementar o fluxo do sistema da NIO (espelhar providers/claro.js).
export const nio = {
  key: 'nio',
  name: 'Nio',
  resultFieldId: () => config.datacrazy.results.nio,
  loginUrl: config.nio.loginUrl,
  storageState: config.nio.storageState,

  async loginInteractive() {
    if (!config.nio.loginUrl) throw new Error('Defina NIO_LOGIN_URL no .env antes de logar na Nio.');
    await loginAndSave({
      loginUrl: config.nio.loginUrl,
      storageState: config.nio.storageState,
      successWhen: (url) => !url.toString().includes('/login'),
    });
  },

  async consultar(/* cliente */) {
    throw new Error('Provider NIO ainda não implementado. Mapeie o portal e preencha providers/nio.js.');
  },
};
