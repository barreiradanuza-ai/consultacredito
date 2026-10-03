// Login manual diário de uma operadora.
// Uso: npm run login claro   (ou tim / nio)
import { getProvider } from './providers/index.js';

const key = process.argv[2];
const provider = getProvider(key);
if (!provider) {
  console.error('Uso: npm run login <claro|tim|nio>');
  process.exit(1);
}
await provider.loginInteractive();
process.exit(0);
