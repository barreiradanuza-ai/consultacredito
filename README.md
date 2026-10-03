# consultacredito — Análise de crédito automática (DataCrazy × operadoras)

Quando um lead entra na etapa **"Análise de Crédito"** no DataCrazy, este serviço consulta o
crédito do cliente em **cada operadora ativa** (Claro agora; TIM e Nio depois) e grava o
resultado **Sim/Não** no campo correspondente do lead:

| Operadora | Campo no DataCrazy | Status |
|-----------|--------------------|--------|
| Claro     | `Claro Aprovado`   | ✅ implementado |
| TIM       | `Tim Aprovado`     | ⏳ estrutura pronta (preencher `src/providers/tim.js`) |
| Nio       | `Nio Aprovado`     | ⏳ estrutura pronta (preencher `src/providers/nio.js`) |

> ⚠️ Automação dos portais (não há API oficial de crédito). Pontos sensíveis: **login manual
> diário** por operadora (a sessão cai), fragilidade se o portal mudar, e **LGPD** (dado
> sensível — garanta base legal/consentimento). O deploy e as credenciais são do operador.

## Arquitetura

```
DataCrazy (etapa "Análise de Crédito")
     │ webhook → POST /webhook/datacrazy (header x-webhook-secret)
     ▼
  Serviço (este repo)
     │ GET lead → Nome, CPF, Nascimento
     │ para cada operadora ativa: automação do portal → aprovado/reprovado
     ▼
  PATCH lead → "Claro Aprovado" / "Tim Aprovado" / "Nio Aprovado" = Sim/Não
```

Cada operadora é um **provider** em `src/providers/` com a mesma interface
(`consultar(cliente)`, `loginInteractive()`, `resultFieldId()`). Adicionar uma operadora =
criar um arquivo em `providers/` espelhando `claro.js` e ligá-la em `PROVIDERS`.

## Passo a passo

```bash
npm install
npx playwright install chromium        # (ou use o Dockerfile)
cp .env.example .env                    # preencha os valores

# 1) descubra os IDs dos campos adicionais do DataCrazy
node src/testDatacrazy.js <LEAD_ID>     # copie os ids para o .env

# 2) login diário da operadora (abre navegador p/ você logar)
npm run login claro

# 3) calibre uma consulta real (CPF autorizado, navegador visível)
node src/testClaro.js claro <CPF>

# 4) suba o serviço
npm start
```

No **DataCrazy**, configure a automação da etapa "Análise de Crédito" para chamar:
```
POST https://SEU-DOMINIO/webhook/datacrazy
Header: x-webhook-secret: <igual ao WEBHOOK_SECRET>
```

## Adicionar TIM / Nio depois
1. `PROVIDERS=claro,tim,nio` no `.env` e preencha `TIM_LOGIN_URL` / `NIO_LOGIN_URL` + os `FIELD_ID_*_APROVADO`.
2. Implemente `src/providers/tim.js` e `nio.js` (espelhe `claro.js`: login, navegação até a consulta, `parseAprovacao`).
3. `npm run login tim` / `npm run login nio`.

## Deploy no Railway
`Dockerfile` baseado na imagem oficial da Playwright (Chromium incluso). Defina as variáveis do
`.env.example` em **Variables**. A sessão de cada operadora (`data/*-session.json`) precisa
existir no servidor — gere localmente com `npm run login <op>` e persista via **Volume** do
Railway. (Automação de navegador em nuvem é o ponto mais delicado; para robustez, avalie uma
API de bureau de crédito.)

## A confirmar no 1º uso real
- [ ] Payload do webhook do DataCrazy (`parseWebhook` em `creditFlow.js`).
- [ ] Shape do `additionalFields` no PATCH (lista de `{id, value}`).
- [ ] Textos dos selects e opções da janela de crédito de cada portal.
- [ ] Palavras de aprovado/reprovado em `parseAprovacao` (`providers/_browser.js`).
