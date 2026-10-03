// Uso: node src/testDatacrazy.js <LEAD_ID>
// Mostra os campos adicionais do lead com seus IDs, para você preencher o .env.
import { getLead } from './datacrazy.js';

const id = process.argv[2];
if (!id) { console.error('Informe o LEAD_ID: node src/testDatacrazy.js <id>'); process.exit(1); }

const lead = await getLead(id);
console.log('Nome do lead:', lead?.name);
const af = Array.isArray(lead?.additionalFields) ? lead.additionalFields : [lead?.additionalFields].filter(Boolean);
console.log('\nCampos adicionais (copie o id para o .env):');
for (const f of af) console.log(`- ${f.name}  ->  id: ${f.id}  | valor atual: ${f.value ?? ''}`);
console.log('\nTags:', JSON.stringify(lead?.tags));
