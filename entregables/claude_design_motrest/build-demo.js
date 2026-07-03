// Genera demo.html: demo guiada y clicable del producto. Une las pantallas de
// producto/ en un flujo con hotspots (puntos verdes) + barra de guía + navegación.
// Flujo: POS -> KDS -> Dirección -> Centinela -> Menu engineering -> Copiloto.
// Ejecutar: node build-demo.js
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const STEPS = [
  { file: 'p1-pos-mitad-y-mitad.html',
    guide: 'Paso 1 · Punto de venta — la pizza mitad y mitad se costea en vivo mientras tomas la comanda.',
    hs: { x: 1530, y: 916, label: 'Enviar a cocina', side: 'left' } },
  { file: 'p2-kds-cocina.html',
    guide: 'Paso 2 · Cocina (KDS) — la comanda llegó sola, por estación y con timer.',
    hs: { x: 250, y: 610, label: 'Marcar listo el pedido #0231', side: 'right' } },
  { file: 'p3-dashboard-direccion.html',
    guide: 'Paso 3 · Dirección — la venta ya está en el panel; el Centinela trae una alerta.',
    hs: { x: 1400, y: 585, label: 'Ver la alerta del Centinela', side: 'right' } },
  { file: 'p5-centinela-mermas.html',
    guide: 'Paso 4 · Centinela — la anomalía llega correlacionada con turno y estación, con acción sugerida.',
    hs: { x: 125, y: 468, label: 'Ir a Inteligencia', side: 'right' } },
  { file: 'p4-menu-engineering.html',
    guide: 'Paso 5 · Menu engineering — el agente clasifica tu carta y te dice qué impulsar, rediseñar o retirar.',
    hs: { x: 1540, y: 900, label: 'Cerrar con el Copiloto', side: 'left' } },
  { file: 'p6-copiloto-whatsapp.html',
    guide: 'Paso 6 · Copiloto del Dueño — todo lo que acabas de ver, preguntándole por WhatsApp.',
    hs: null, phone: true }
];

function prefixCss(css, id) {
  return css.replace(/([^{}]+)\{/g, function (_m, sel) {
    var out = sel.split(',').map(function (s) {
      s = s.trim();
      if (s === '*') return '#' + id + ', #' + id + ' *';
      if (s === 'html' || s === 'body' || s === ':root') return '#' + id;
      return '#' + id + ' ' + s;
    });
    return out.filter(function (v, k) { return out.indexOf(v) === k; }).join(',') + '{';
  });
}

var styles = [], sections = [], guides = [];
STEPS.forEach(function (st, idx) {
  var html = fs.readFileSync(path.join(dir, 'producto', st.file), 'utf8');
  var id = 'g' + (idx + 1);
  styles.push(prefixCss(html.match(/<style>([\s\S]*?)<\/style>/)[1], id));
  var body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
    .replace(/<script id="fit">[\s\S]*?<\/script>\s*/g, '');
  var inner = '<div id="' + id + '">' + body + '</div>';
  if (st.phone) inner = '<div class="ph-wrap"><div class="ph-bezel">' + inner + '</div></div>';
  var hs = '';
  if (st.hs) {
    hs = '<div class="hs' + (st.hs.side === 'left' ? ' left' : '') + '" style="left:' + st.hs.x + 'px;top:' + st.hs.y + 'px" onclick="next()">' +
      (st.hs.side === 'left' ? '<span>' + st.hs.label + '</span><i></i>' : '<i></i><span>' + st.hs.label + '</span>') + '</div>';
  }
  sections.push('<section>' + inner + hs + '</section>');
  guides.push(st.guide);
});

var deck = [
  '<!doctype html>',
  '<html lang="es"><head>',
  '<meta charset="utf-8">',
  '<title>MotRest — Demo clicable</title>',
  '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
  '<style>',
  'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0B0D0E}',
  '#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;box-shadow:0 24px 80px rgba(0,0,0,.5)}',
  '#stage>section{display:none;position:relative;width:1920px;height:1080px}',
  '#stage>section.active{display:block}',
  '.ph-wrap{width:1920px;height:1080px;background:#14181A;display:flex;align-items:center;justify-content:center;position:relative}',
  '.ph-bezel{padding:14px;background:#0B0D0E;border-radius:52px;border:2px solid #2A3237;box-shadow:0 40px 90px rgba(0,0,0,.55);overflow:hidden;transform:scale(1.05)}',
  '.ph-bezel>div{border-radius:38px;overflow:hidden}',
  '.hs{position:absolute;z-index:50;display:flex;align-items:center;gap:14px;cursor:pointer}',
  '.hs i{width:36px;height:36px;border-radius:50%;background:#F2853A;border:4px solid #fff;box-shadow:0 0 0 0 rgba(242,133,58,.55);animation:pulse 1.6s infinite;flex:none}',
  '@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(242,133,58,.55)}100%{box-shadow:0 0 0 30px rgba(242,133,58,0)}}',
  ".hs span{background:#14181A;color:#fff;font:600 19px 'Space Grotesk','Segoe UI',Arial,sans-serif;padding:12px 22px;border-radius:999px;white-space:nowrap;box-shadow:0 10px 26px rgba(0,0,0,.4)}",
  "#guide{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:99;display:flex;align-items:center;gap:16px;background:rgba(20,24,26,.94);border:1px solid #2A3237;border-radius:16px;padding:14px 22px;max-width:86vw}",
  "#guide p{margin:0;color:#fff;font:500 16px/1.4 'Inter','Segoe UI',Arial,sans-serif}",
  "#guide p b{color:#F2853A;font-family:'Space Grotesk',sans-serif}",
  "#guide button{flex:none;border:0;border-radius:10px;padding:10px 18px;background:#F2853A;color:#fff;font:600 15px 'Space Grotesk','Segoe UI',sans-serif;cursor:pointer}",
  '#hud{position:fixed;right:28px;bottom:24px;display:flex;gap:10px;align-items:center;z-index:99}',
  "#hud button{border:0;border-radius:12px;padding:10px 18px;background:rgba(45,58,66,.9);color:#fff;font:600 16px 'Space Grotesk','Segoe UI',Arial,sans-serif;cursor:pointer}",
  '#hud button:hover{background:#F2853A}',
  "#count{color:#fff;background:rgba(45,58,66,.9);border-radius:12px;padding:10px 16px;font:600 15px 'Space Grotesk','Segoe UI',Arial,sans-serif}",
  '#bar{position:fixed;left:0;bottom:0;height:5px;background:#F2853A;width:0;transition:width .25s;z-index:99}',
  '#intro{position:fixed;inset:0;z-index:120;background:rgba(11,13,14,.88);display:flex;align-items:center;justify-content:center}',
  "#intro .card{background:#14181A;border:1px solid #2A3237;border-radius:24px;padding:56px 64px;max-width:640px;text-align:center;color:#fff;font-family:'Inter','Segoe UI',Arial,sans-serif}",
  "#intro .eyebrow{font:600 15px 'Space Grotesk',sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#F2853A}",
  "#intro h1{font:700 42px 'Space Grotesk','Segoe UI',sans-serif;margin:16px 0 0}",
  '#intro p{color:#8A969C;font-size:18px;line-height:1.55;margin:18px 0 0}',
  "#intro button{margin-top:32px;border:0;border-radius:14px;padding:16px 40px;background:#F2853A;color:#fff;font:600 20px 'Space Grotesk',sans-serif;cursor:pointer}",
  styles.join('\n'),
  '</style></head><body>',
  '<div id="stage">',
  sections.join('\n'),
  '</div>',
  '<div id="guide"><p id="gtext"></p><button id="gnext" onclick="next()">Siguiente →</button></div>',
  '<div id="hud"><button onclick="prev()" title="Anterior">&#8592;</button><span id="count"></span><button onclick="next()" title="Siguiente">&#8594;</button><button onclick="show(0)" title="Reiniciar">&#8635;</button><button onclick="fsx()" title="Pantalla completa">&#x26F6;</button></div>',
  '<div id="bar"></div>',
  '<div id="intro"><div class="card">',
  '<div class="eyebrow">MOTRAE · MotRest</div>',
  '<h1>Demo guiada del producto</h1>',
  '<p>Recorre el flujo real de un viernes en Rodizio: comanda → cocina → dirección → centinela → carta → copiloto.<br>Toca los <b style="color:#F2853A">puntos naranjas</b> en cada pantalla, o usa «Siguiente».</p>',
  '<button onclick="document.getElementById(\'intro\').style.display=\'none\'">Comenzar demo</button>',
  '</div></div>',
  '<script>',
  'var GUIDES=' + JSON.stringify(guides) + ';',
  "var secs=[].slice.call(document.querySelectorAll('#stage>section')),i=0;",
  "function show(n){i=Math.max(0,Math.min(secs.length-1,n));secs.forEach(function(s,k){s.classList.toggle('active',k===i);});var g=GUIDES[i].split('·');document.getElementById('gtext').innerHTML='<b>'+g[0]+'</b>·'+g.slice(1).join('·');document.getElementById('count').textContent=(i+1)+' / '+secs.length;document.getElementById('bar').style.width=((i+1)/secs.length*100)+'%';document.getElementById('gnext').textContent=(i===secs.length-1)?'Reiniciar ↻':'Siguiente →';}",
  'function next(){if(i===secs.length-1){show(0);}else{show(i+1);}}',
  'function prev(){show(i-1);}',
  'function fsx(){try{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();}catch(e){}}',
  "function fit(){var s=Math.min(innerWidth/1920,innerHeight/1080);document.getElementById('stage').style.transform='translate(-50%,-50%) scale('+s+')';}",
  "addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' ')next();else if(e.key==='ArrowLeft'||e.key==='PageUp')prev();else if(e.key==='Home')show(0);});",
  "addEventListener('resize',fit);fit();show(0);",
  '</scr' + 'ipt></body></html>'
].join('\n');

fs.writeFileSync(path.join(dir, 'demo.html'), deck);
console.log('OK: demo.html generado con ' + STEPS.length + ' pasos.');

// rebrand-naranja
