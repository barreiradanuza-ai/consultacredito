import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (!v) console.warn(`[config] AVISO: variável ${name} não definida no .env`);
  return v || '';
}

// Operadoras ativas (ex.: "claro" agora; "claro,tim,nio" depois)
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
    // Campos de ENTRADA (dados do cliente)
    fields: {
      nome: req('FIELD_ID_NOME'),
      cpf: req('FIELD_ID_CPF'),
      nascimento: req('FIELD_ID_NASCIMENTO'),
    },
    // Campos de RETORNO, um por operadora (Texto: "Sim"/"Não")
    results: {
      claro: process.env.FIELD_ID_CLARO_APROVADO || '',
      tim: process.env.FIELD_ID_TIM_APROVADO || '',
      nio: process.env.FIELD_ID_NIO_APROVADO || '',
    },
  },

  // Configuração por operadora
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
      tipoCliente: process.env.CLARO_TIPO_CLIENTE || 'PESSOA FISICA',
      tipoVenda: process.env.CLARO_TIPO_VENDA || '',
      tipoConsulta: process.env.CLARO_TIPO_CONSULTA || 'CPF',
    },
    storageState: process.env.CLARO_STORAGE_STATE || './data/claro-session.json',
    loginUrl: (process.env.CLARO_BASE_URL || 'https://app.conexaoclarobrasil.com.br') + '/login',
  },

  tim: {
    baseUrl: process.env.TIM_BASE_URL || '',
    storageState: process.env.TIM_STORAGE_STATE || './data/tim-session.json',
    loginUrl: process.env.TIM_LOGIN_URL || '',
  },

  nio: {
    baseUrl: process.env.NIO_BASE_URL || '',
    storageState: process.env.NIO_STORAGE_STATE || './data/nio-session.json',
    loginUrl: process.env.NIO_LOGIN_URL || '',
  },

  headless: (process.env.HEADLESS || 'true') !== 'false',
};
