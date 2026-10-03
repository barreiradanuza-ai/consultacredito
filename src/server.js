import express from 'express';
import { config } from './config.js';
import { enqueue, parseWebhook, loginStatus } from './creditFlow.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({ ok: true, operadoras: config.enabledProviders, sessõesCaidas: loginStatus() });
});

app.post('/webhook/datacrazy', (req, res) => {
  if (req.headers['x-webhook-secret'] !== config.webhookSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { leadId, stageName } = parseWebhook(req.body);
  console.log(`[webhook] lead=${leadId} etapa="${stageName}"`);
  res.json({ ok: true, received: true });

  if (!leadId) {
    console.warn('[webhook] payload sem leadId:', JSON.stringify(req.body).slice(0, 500));
    return;
  }
  const alvo = config.datacrazy.triggerStageName.toLowerCase();
  if (stageName && !stageName.toLowerCase().includes(alvo)) {
    console.log(`[webhook] etapa "${stageName}" != "${config.datacrazy.triggerStageName}", ignorando.`);
    return;
  }
  enqueue(leadId);
});

app.listen(config.port, () => {
  console.log(`Serviço de consulta de crédito ouvindo na porta ${config.port}`);
  console.log(`Operadoras ativas: ${config.enabledProviders.join(', ')}`);
  console.log('Webhook: POST /webhook/datacrazy (header x-webhook-secret)');
});
