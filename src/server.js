import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { enqueue, parseWebhook, loginStatus } from './creditFlow.js';
 
const app = express();
app.use(express.json({ limit: '1mb' }));
 
// Token exclusivo para upload de sessão (não é o WEBHOOK_SECRET).
const SESSION_TOKEN = process.env.CLARO_SESSION_TOKEN || config.webhookSecret;
const STORAGE = config.claro.storageState;
 
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
  fs.mkdirSync(path.dirname(STORAGE), { recursive: true });
  fs.writeFileSync(STORAGE, JSON.stringify(body.state));
  console.log(`[admin] sessão do Claro salva (${body.state.cookies.length} cookies).`);
  res.json({ ok: true, salvo: true, cookies: body.state.cookies.length });
});
app.options('/admin/claro-session', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  res.status(204).end();
});
 
// Status em JSON (a página consulta a cada poucos segundos).
app.get('/admin/status', (_req, res) => res.json(sessionInfo()));
 
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
</div>
<script>
  var TOKEN = ${JSON.stringify(SESSION_TOKEN)};
  var ENDPOINT = location.origin + '/admin/claro-session';
  // Código do favorito (roda na página do Claro): captura cookies + localStorage e envia.
  var code = "(function(){try{" +
    "var ck=document.cookie.split('; ').filter(Boolean).map(function(p){var i=p.indexOf('=');" +
    "var n=p.slice(0,i),v=p.slice(i+1);return{name:n,value:v,domain:'.conexaoclarobrasil.com.br',path:'/'," +
    "expires:Math.floor(Date.now()/1000)+60*60*24*30,httpOnly:false,secure:true,sameSite:'Lax'};});" +
    "var ls=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);ls.push({name:k,value:localStorage.getItem(k)});}" +
    "var state={cookies:ck,origins:[{origin:location.origin,localStorage:ls}]};" +
    "fetch(" + JSON.stringify(ENDPOINT) + ",{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'}," +
    "body:JSON.stringify({secret:" + JSON.stringify(TOKEN) + ",state:state})})" +
    ".then(function(){alert('Sessao Claro enviada! Pode fechar. ('+ck.length+' cookies)');})" +
    ".catch(function(e){alert('Falha ao enviar: '+e);});" +
    "}catch(e){alert('Erro: '+e);}})();";
  var bm = document.getElementById('bm');
  bm.href = 'javascript:' + encodeURIComponent(code);
  bm.addEventListener('click', function(e){ e.preventDefault(); alert('Não clique aqui. Arraste este botão para a barra de favoritos e clique nele quando estiver no site do Claro.'); });
 
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
