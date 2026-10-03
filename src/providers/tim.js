import { config } from '../config.js';
import { loginAndSave, NeedsLoginError } from './_browser.js';

// TODO: implementar o fluxo do sistema da TIM (espelhar providers/claro.js).
// Mapeie no portal da TIM: login, navegação até a consulta de crédito e parse do resultado.
export const tim = {
  key: 'tim',
  name: 'TIM',
  resultFieldId: () => config.datacrazy.results.tim,
  loginUrl: config.tim.loginUrl,
  storageState: config.tim.storageState,

  async loginInteractive() {
    if (!config.tim.loginUrl) throw new Error('Defina TIM_LOGIN_URL no .env antes de logar na TIM.');
    await loginAndSave({
      loginUrl: config.tim.loginUrl,
      storageState: config.tim.storageState,
      successWhen: (url) => !url.toString().includes('/login'),
    });
  },

  async consultar(/* cliente */) {
    throw new Error('Provider TIM ainda não implementado. Mapeie o portal e preencha providers/tim.js.');
  },
};
