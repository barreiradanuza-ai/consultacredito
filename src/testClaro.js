// Teste/calibração de UMA consulta (precisa ter feito: npm run login <op>).
// Uso: node src/testClaro.js <operadora> <CPF> ["NOME"] ["NASCIMENTO"]
//   ex.: node src/testClaro.js claro 11122233344
import { getProvider } from './providers/index.js';

const key = process.argv[2];
const cpf = (process.argv[3] || '').replace(/\D/g, '');
const nome = process.argv[4] || '';
const nascimento = process.argv[5] || '';

const provider = getProvider(key);
if (!provider || !cpf) {
  console.error('Uso: node src/testClaro.js <claro|tim|nio> <cpf> ["nome"] ["nascimento"]');
  process.exit(1);
}
process.env.HEADLESS = 'false';

const r = await provider.consultar({ cpf, nome, nascimento });
console.log('\n=== RESULTADO ===');
console.log('Operadora:', provider.name);
console.log('Aprovado:', r.aprovado);
console.log('Texto bruto:', r.raw);
process.exit(0);
