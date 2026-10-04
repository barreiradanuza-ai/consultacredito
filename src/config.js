import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (!v) console.warn(`[config] AVISO: variável ${name} não definida no .env`);
  return v || '';
}

const enabledProviders = (process.env.PROVIDERS || 'claro')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  webhookSecret: req('WEBHOOK_SECRET'),
  enabledProviders,

  datacrazy: {
    token: req('DATACRAZY_TOKEN'),
    baseUrl: process.env.DATACRAZY_BASE_URL || 'https://api.g1.datacrazy.io',
    triggerStageName: process.env.TRIGGER_STAGE_NAME || 'Análise de Crédito',
    fields: {
      nome: process.env.FIELD_ID_NOME || 'Nome Lead',
      cpf: process.env.FIELD_ID_CPF || 'CPF Lead',
      nascimento: process.env.FIELD_ID_NASCIMENTO || 'Nascimento Lead',
    },
    results: {
      claro: process.env.FIELD_ID_CLARO_APROVADO || 'Claro Aprovado',
      tim: process.env.FIELD_ID_TIM_APROVADO || 'Tim Aprovado',
      nio: process.env.FIELD_ID_NIO_APROVADO || 'Nio Aprovado',
    },
  },

  claro: {
    baseUrl: process.env.CLARO_BASE_URL || 'https://app.conexaoclarobrasil.com.br',
    endereco: {
      tipoServico: process.env.CLARO_TIPO_SERVICO || 'COM CABO',
      estado: process.env.CLARO_ESTADO || 'RIO DE JANEIRO',
      cidade: process.env.CLARO_CIDADE || 'RIO DE JANEIRO',
      cep: process.env.CLARO_CEP || '22790-410',
      numero: process.env.CLARO_NUMERO || '40',
    },
    credito: {
      tipoCliente: process.env.CLARO_TIPO_CLIENTE || 'RESIDENCIAL',
      tipoVenda: process.env.CLARO_TIPO_VENDA || 'PROSPECT',
      tipoConsulta: process.env.CLARO_TIPO_CONSULTA || 'CPF',
    },
    storageState: process.env.CLARO_STORAGE_STATE || './data/claro-session.json',
    loginUrl: (process.env.CLARO_BASE_URL || 'https://app.conexaoclarobrasil.com.br') + '/login',
    email: process.env.CLARO_EMAIL || '',
    senha: process.env.CLARO_SENHA || '',
  },

  tim: { baseUrl: process.env.TIM_BASE_URL || '', storageState: process.env.TIM_STORAGE_STATE || './data/tim-session.json', loginUrl: process.env.TIM_LOGIN_URL || '' },
  nio: { baseUrl: process.env.NIO_BASE_URL || '', storageState: process.env.NIO_STORAGE_STATE || './data/nio-session.json', loginUrl: process.env.NIO_LOGIN_URL || '' },

  headless: (process.env.HEADLESS || 'true') !== 'false',
};
