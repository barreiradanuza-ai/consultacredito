import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { enqueue, parseWebhook, loginStatus } from './creditFlow.js';
import { openSession } from './providers/_browser.js';
import { tim } from './providers/tim.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Token exclusivo para upload de sessão (não é o WEBHOOK_SECRET).
const SESSION_TOKEN = process.env.CLARO_SESSION_TOKEN || config.webhookSecret;
const STORAGE = config.claro.storageState;
const TIM_STORAGE = '/data/tim-session.json';
const TIM_URL = 'https://apptimvendas.timbrasil.com.br/';

function sessionInfo() {
  try {
    const st = fs.statSync(STORAGE);
    return { existe: true, atualizadaEm: st.mtime.toISOString(), tamanho: st.size };
  } catch {
    return { existe: false, atualizadaEm: null, tamanho: 0 };
  }
}

app.get('/', (_req, res) => {
  res.json({ ok: true, operadoras: config.enabledProviders, sessõesCaidas: loginStatus(), claroSessao: sessionInfo() });
});

// ---------- Webhook do DataCrazy ----------
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

// ---------- Recebe a sessão capturada do Claro ----------
// Aceita text/plain para evitar preflight de CORS (o botão envia no-cors).
app.post('/admin/claro-session', express.text({ type: '*/*', limit: '4mb' }), (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  let body;
  try { body = JSON.parse(req.body); } catch { return res.status(400).json({ error: 'json inválido' }); }
  if (!body || body.secret !== SESSION_TOKEN) return res.status(401).json({ error: 'token inválido' });
  if (!body.state || !Array.isArray(body.state.cookies)) return res.status(400).json({ error: 'state inválido' });
  // Rejeita sessão vazia / não logada (evita apagar uma sessão boa com uma captura fora do Claro).
  let autenticado = false;
  try {
    const ls = (body.state.origins || []).flatMap((o) => o.localStorage || []);
    const pr = ls.find((x) => x.name === 'persist:root');
    if (pr) { const login = JSON.parse(JSON.parse(pr.value).login || '{}'); autenticado = login.authenticated === true; }
  } catch { autenticado = false; }
  if (!autenticado) {
    console.warn('[admin] captura sem login — recusada (não sobrescreve a sessão).');
    return res.status(400).json({ error: 'nao_logado', msg: 'Capturei uma página SEM login do Claro. Entre no Claro Conexão (logado) e clique o botão lá dentro.' });
  }
  fs.mkdirSync(path.dirname(STORAGE), { recursive: true });
  fs.writeFileSync(STORAGE, JSON.stringify(body.state));
  console.log(`[admin] sessão do Claro salva (${body.state.cookies.length} cookies, logado=ok).`);
  res.json({ ok: true, salvo: true, cookies: body.state.cookies.length });
});
app.options('/admin/claro-session', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  res.status(204).end();
});

// Status em JSON (a página consulta a cada poucos segundos).
app.get('/admin/status', (_req, res) => res.json(sessionInfo()));

// Proxy de diagnóstico p/ a API do DataCrazy (achar ids de campos). Protegido pelo token.
app.get('/admin/dc', async (req, res) => {
  if (req.query.token !== SESSION_TOKEN) return res.status(401).json({ error: 'token inválido' });
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'informe ?path=' });
  try {
    const r = await fetch(`${config.datacrazy.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${config.datacrazy.token}`, Accept: 'application/json' },
    });
    const text = await r.text();
    res.status(200).json({ status: r.status, body: text.slice(0, 6000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// TESTE: abre o app do TIM headless (sem sessão) p/ ver se a Imperva bloqueia. Protegido.
app.get('/admin/tim-probe', async (req, res) => {
  if (req.query.token !== SESSION_TOKEN) return res.status(401).json({ error: 'token inválido' });
  let browser;
  try {
    const sess = await openSession('tim', null); browser = sess.browser;
    const page = sess.page;
    await page.goto('https://apptimvendas.timbrasil.com.br/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    const info = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      htmlLen: document.documentElement.outerHTML.length,
      hasApp: !!document.querySelector('ion-app, app-root'),
      bodyText: (document.body.innerText || '').slice(0, 300),
      imperva: /Incapsula|_Incapsula|request unsuccessful|incident id|Request unsuccessful/i.test(document.documentElement.outerHTML),
    }));
    res.json({ ok: true, info });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Recebe a sessão do TIM (cookies+localStorage+IndexedDB) capturada pelo botão.
app.post('/admin/tim-session', express.text({ type: '*/*', limit: '8mb' }), (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  let body;
  try { body = JSON.parse(req.body); } catch { return res.status(400).json({ error: 'json inválido' }); }
  if (!body || body.secret !== SESSION_TOKEN) return res.status(401).json({ error: 'token inválido' });
  const st = body.state || {};
  const temToken = !!(st.idb && st.idb.accessToken);
  if (!temToken) return res.status(400).json({ error: 'nao_logado', msg: 'Capturei o TIM SEM login (sem accessToken). Entre no TIM logado e clique o botão lá dentro.' });
  fs.mkdirSync(path.dirname(TIM_STORAGE), { recursive: true });
  fs.writeFileSync(TIM_STORAGE, JSON.stringify(st));
  console.log(`[admin] sessão do TIM salva (idb keys=${Object.keys(st.idb).length}).`);
  res.json({ ok: true, salvo: true });
});

// Página que recebe a sessão do TIM via fragmento (#) e salva (contorna CSP do TIM).
app.get('/admin/tim-recv', (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Enviando sessão TIM…</title>
<style>body{margin:0;font:18px/1.6 system-ui,Arial;background:#0f1115;color:#e7eaf0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}.b{max-width:420px}.ok{color:#22c55e}.bad{color:#ef4444}.big{font-size:42px}</style></head>
<body><div class="b"><div id="ic" class="big">⏳</div><h2 id="m">Enviando sessão do TIM…</h2><p id="s" style="color:#9aa3b2"></p></div>
<script>(async function(){var ic=document.getElementById('ic'),m=document.getElementById('m'),s=document.getElementById('s');try{
 var b64=location.hash.slice(1); if(!b64) throw new Error('Nada recebido. Clique o botão dentro do TIM logado.');
 var state=JSON.parse(decodeURIComponent(escape(atob(b64))));
 var r=await fetch('/admin/tim-session',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({secret:${JSON.stringify(SESSION_TOKEN)},state:state})});
 var j=await r.json();
 if(r.ok&&j.ok){ic.textContent='✅';ic.className='big ok';m.textContent='Sessão TIM salva!';s.textContent='Pode fechar esta aba.';}
 else throw new Error(j.msg||j.error||('HTTP '+r.status));
}catch(e){ic.textContent='❌';ic.className='big bad';m.textContent='Falha';s.textContent=String(e&&e.message||e);}})();</script></body></html>`);
});

// TESTE decisivo: injeta a sessão salva do TIM num headless e vê se fica logado.
app.get('/admin/tim-login-test', async (req, res) => {
  if (req.query.token !== SESSION_TOKEN) return res.status(401).json({ error: 'token inválido' });
  let browser;
  try {
    const bundle = JSON.parse(fs.readFileSync(TIM_STORAGE, 'utf8'));
    const sess = await openSession('tim', null); browser = sess.browser;
    const page = sess.page;
    await page.goto(TIM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000); // headless estabelece a própria sessão Imperva + cria o IndexedDB
    // injeta os tokens do app no IndexedDB (_ionicstorage/_ionickv)
    await page.evaluate(async (idb) => {
      await new Promise((resolve) => {
        const open = indexedDB.open('_ionicstorage');
        open.onupgradeneeded = () => { try { open.result.createObjectStore('_ionickv'); } catch (e) {} };
        open.onsuccess = () => {
          const db = open.result;
          let store;
          try { store = db.transaction('_ionickv', 'readwrite').objectStore('_ionickv'); }
          catch (e) { return resolve(); }
          for (const k in idb) { try { store.put(idb[k], k); } catch (e) {} }
          store.transaction.oncomplete = () => resolve();
          store.transaction.onerror = () => resolve();
        };
        open.onerror = () => resolve();
      });
    }, bundle.idb || {});
    await page.goto(TIM_URL + '#/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    const info = await page.evaluate(() => ({ url: location.href, onLogin: location.href.includes('/login'), title: document.title }));
    res.json({ ok: true, logado: !info.onLogin, info });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  } finally {
    if (browser) await browser.close();
  }
});

// TESTE do fluxo TIM com um CPF (sem DataCrazy). Ex.: /admin/tim-consulta?token=..&cpf=02255615657
app.get('/admin/tim-consulta', async (req, res) => {
  if (req.query.token !== SESSION_TOKEN) return res.status(401).json({ error: 'token inválido' });
  const cliente = {
    cpf: String(req.query.cpf || '').replace(/\D/g, ''),
    nome: req.query.nome || '',
    nascimento: req.query.nasc || '',
    mae: req.query.mae || '',
  };
  if (cliente.cpf.length !== 11) return res.status(400).json({ error: 'cpf inválido (11 díg)' });
  try {
    const r = await tim.consultar(cliente);
    res.json({ ok: true, resultado: r });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  }
});

// Dispara a análise de um lead manualmente (reprocessar). Protegido pelo token.
app.get('/admin/run/:leadId', (req, res) => {
  if (req.query.token !== SESSION_TOKEN) return res.status(401).json({ error: 'token inválido' });
  const leadId = String(req.params.leadId || '').replace(/[{}"'\s]/g, '').trim();
  if (!leadId) return res.status(400).json({ error: 'leadId vazio' });
  enqueue(leadId);
  console.log(`[admin] rodada manual enfileirada: ${leadId}`);
  res.json({ ok: true, enfileirado: leadId });
});

// ---------- Recebe a sessão vinda do favorito (dados no fragmento #) ----------
app.get('/admin/recv', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Enviando sessão…</title>
<style>body{margin:0;font:18px/1.6 system-ui,Arial;background:#0f1115;color:#e7eaf0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}
.box{max-width:420px}.ok{color:#22c55e}.bad{color:#ef4444}.big{font-size:42px;margin-bottom:8px}</style></head>
<body><div class="box"><div id="ic" class="big">⏳</div><h2 id="msg">Enviando sessão do Claro…</h2>
<p id="sub" style="color:#9aa3b2"></p></div>
<script>
  (async function(){
    var ic=document.getElementById('ic'),msg=document.getElementById('msg'),sub=document.getElementById('sub');
    try{
      var b64=location.hash.slice(1);
      if(!b64){throw new Error('Nada recebido. Clique no favorito estando dentro do Claro.');}
      var state=JSON.parse(decodeURIComponent(escape(atob(b64))));
      var r=await fetch('/admin/claro-session',{method:'POST',headers:{'Content-Type':'text/plain'},
        body:JSON.stringify({secret:${JSON.stringify(SESSION_TOKEN)},state:state})});
      var j=await r.json();
      if(r.ok&&j.ok){ic.textContent='✅';ic.className='big ok';msg.textContent='Sessão salva com sucesso!';
        sub.textContent='Pode fechar esta aba. A análise de crédito já está funcionando.';}
      else{throw new Error(j.error||('HTTP '+r.status));}
    }catch(e){var ic=document.getElementById('ic');ic.textContent='❌';ic.className='big bad';
      document.getElementById('msg').textContent='Falha ao salvar a sessão';
      document.getElementById('sub').textContent=String(e&&e.message||e);}
  })();
</script></body></html>`);
});

// ---------- Página de login diário ----------
app.get('/admin', (_req, res) => {
  const claroUrl = config.claro.baseUrl;
  res.type('html').send(`<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sessão Claro — login diário</title>
<style>
  :root{--bg:#0f1115;--card:#171a21;--line:#262b36;--txt:#e7eaf0;--mut:#9aa3b2;--ok:#22c55e;--bad:#ef4444;--accent:#da1f26}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.5 system-ui,Segoe UI,Roboto,Arial;background:var(--bg);color:var(--txt);padding:24px}
  .wrap{max-width:640px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:var(--mut);margin:0 0 20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
  .status{display:flex;align-items:center;gap:10px;font-weight:600}
  .dot{width:12px;height:12px;border-radius:50%}
  .ok{background:var(--ok)}.bad{background:var(--bad)}
  .muted{color:var(--mut);font-size:14px;margin-top:6px}
  ol{margin:12px 0 0;padding-left:20px}li{margin:8px 0}
  .btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;
       padding:12px 18px;border-radius:10px;border:0;cursor:grab;user-select:none}
  .btn:active{cursor:grabbing}
  a.link{color:#7aa2ff}
  code{background:#0b0d11;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:13px}
  .hint{font-size:13px;color:var(--mut);margin-top:10px}
</style></head>
<body><div class="wrap">
  <h1>Sessão do Claro Conexão</h1>
  <p class="sub">Faça isso 1x por dia para a análise de crédito continuar funcionando.</p>

  <div class="card">
    <div class="status"><span id="dot" class="dot bad"></span><span id="st">verificando…</span></div>
    <div id="when" class="muted"></div>
  </div>

  <div class="card">
    <strong>Como atualizar a sessão (todo dia):</strong>
    <ol>
      <li>Abra e faça login no <a class="link" href="${claroUrl}/login" target="_blank" rel="noopener">Claro Conexão</a>.</li>
      <li>Com o Claro aberto, clique no botão <b>Enviar sessão Claro</b> que você guardou nos favoritos.</li>
      <li>Pronto: o indicador acima fica <span style="color:var(--ok)">verde</span>.</li>
    </ol>
    <p class="hint">Instalar o botão (só na 1ª vez): arraste o botão abaixo para a sua <b>barra de favoritos</b> do navegador.</p>
    <p><a id="bm" class="btn" href="#">⬆ Enviar sessão Claro</a></p>
    <p class="hint">Não dá pra clicar nele aqui — ele só funciona quando você estiver <b>dentro do site do Claro</b>.</p>
  </div>

  <div class="card">
    <strong>Sessão do TIM Vendas (em teste):</strong>
    <ol>
      <li>Abra e faça login no <a class="link" href="${TIM_URL}" target="_blank" rel="noopener">TIM Vendas</a>.</li>
      <li>Com o TIM aberto e logado, clique no botão <b>Enviar sessão TIM</b> dos favoritos.</li>
    </ol>
    <p class="hint">Instalar (só na 1ª vez): arraste o botão abaixo para a <b>barra de favoritos</b>.</p>
    <p><a id="bmtim" class="btn" href="#" style="background:#004691">⬆ Enviar sessão TIM</a></p>
    <p class="hint">Só funciona clicado <b>dentro do TIM Vendas logado</b>.</p>
  </div>
</div>
<script>
  var RECV = location.origin + '/admin/recv';
  // Favorito (roda na página do Claro): captura sessão e ABRE uma aba no serviço levando os dados
  // no fragmento (#) da URL. Contorna a CSP do Claro (que bloqueia fetch), pois é só navegação.
  var code = "(function(){try{" +
    "if(location.hostname.indexOf('conexaoclarobrasil')<0){alert('Abra o site do CLARO CONEXAO (logado) e clique este botao LA DENTRO.');return;}" +
    "var auth=false;try{var pr=JSON.parse(localStorage.getItem('persist:root')||'{}');var lg=JSON.parse(pr.login||'{}');auth=lg.authenticated===true;}catch(e){}" +
    "if(!auth){alert('Voce nao esta logado no Claro. Faca login e clique o botao de novo.');return;}" +
    "var ck=document.cookie.split('; ').filter(Boolean).map(function(p){var i=p.indexOf('=');" +
    "var n=p.slice(0,i),v=p.slice(i+1);return{name:n,value:v,domain:'.conexaoclarobrasil.com.br',path:'/'," +
    "expires:Math.floor(Date.now()/1000)+60*60*24*30,httpOnly:false,secure:true,sameSite:'Lax'};});" +
    "var ls=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);ls.push({name:k,value:localStorage.getItem(k)});}" +
    "var state={cookies:ck,origins:[{origin:location.origin,localStorage:ls}]};" +
    "var b64=btoa(unescape(encodeURIComponent(JSON.stringify(state))));" +
    "window.open(" + JSON.stringify(RECV) + "+'#'+b64,'_blank');" +
    "}catch(e){alert('Erro ao capturar sessão: '+e);}})();";
  var bm = document.getElementById('bm');
  bm.href = 'javascript:' + encodeURIComponent(code);
  bm.addEventListener('click', function(e){ e.preventDefault(); alert('Não clique aqui. Arraste este botão para a barra de favoritos e clique nele quando estiver no site do Claro (logado).'); });

  // ---- Botão TIM (captura cookies+localStorage+IndexedDB do app Ionic) ----
  var TIMRECV = location.origin + '/admin/tim-recv';
  var codeTim = "(function(){try{" +
    "if(location.hostname.indexOf('apptimvendas')<0){alert('Abra o TIM VENDAS (logado) e clique este botao LA DENTRO.');return;}" +
    "(async function(){" +
    "function openDB(){return new Promise(function(res){var r=indexedDB.open('_ionicstorage');r.onsuccess=function(){res(r.result)};r.onerror=function(){res(null)};});}" +
    "var db=await openDB(); if(!db){alert('Nao achei o armazenamento do TIM.');return;}" +
    "var idb={}; await new Promise(function(res){var tx=db.transaction('_ionickv','readonly').objectStore('_ionickv');var kr=tx.getAllKeys();kr.onsuccess=function(){var ks=kr.result;var vr=tx.getAll();vr.onsuccess=function(){ks.forEach(function(k,i){idb[String(k)]=vr.result[i]});res()}};kr.onerror=function(){res()}});" +
    "if(!idb.accessToken){alert('Voce nao esta logado no TIM. Faca login e clique de novo.');return;}" +
    "var keep=['accessToken','clientAccessToken','code','currentUser','AccessTokenExpiresIn','clientAccessTokenExpiresIn','jwtLastName','pdv','pdvInfo','promoter','isApp'];" +
    "var slim={}; keep.forEach(function(k){ if(idb[k]!==undefined) slim[k]=idb[k]; });" +
    "var ls={}; var rz=localStorage.getItem('reese84'); if(rz) ls.reese84=rz;" +
    "var state={idb:slim, ls:ls};" +
    "var b64=btoa(unescape(encodeURIComponent(JSON.stringify(state))));" +
    "window.open(" + JSON.stringify(TIMRECV) + "+'#'+b64,'_blank');" +
    "})();" +
    "}catch(e){alert('Erro ao capturar sessão TIM: '+e);}})();";
  var bmtim = document.getElementById('bmtim');
  bmtim.href = 'javascript:' + encodeURIComponent(codeTim);
  bmtim.addEventListener('click', function(e){ e.preventDefault(); alert('Não clique aqui. Arraste para os favoritos e clique DENTRO do TIM Vendas logado.'); });

  function refresh(){
    fetch('/admin/status').then(function(r){return r.json();}).then(function(s){
      var dot=document.getElementById('dot'), st=document.getElementById('st'), when=document.getElementById('when');
      if(s.existe){ dot.className='dot ok'; st.textContent='Sessão ativa';
        when.textContent='Atualizada em: '+ new Date(s.atualizadaEm).toLocaleString('pt-BR'); }
      else { dot.className='dot bad'; st.textContent='Sem sessão — faça o login e clique no botão.'; when.textContent=''; }
    }).catch(function(){});
  }
  refresh(); setInterval(refresh, 4000);
</script>
</body></html>`);
});

app.listen(config.port, () => {
  console.log(`Serviço de consulta de crédito ouvindo na porta ${config.port}`);
  console.log(`Operadoras ativas: ${config.enabledProviders.join(', ')}`);
  console.log('Webhook: POST /webhook/datacrazy (header x-webhook-secret)');
  console.log('Login diário: GET /admin');
});
