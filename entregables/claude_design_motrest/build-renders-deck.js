// Genera renders-deck.html: los 6 renders de renders/ en un solo archivo
// navegable (flechas, teclado, contador, pantalla completa), igual que el
// deck comercial (build-deck.js). Ejecutar: node build-renders-deck.js
// Cadena de fuentes: producto/*.html -> (build-renders.js) -> renders/*.html -> este deck.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const rendersDir = path.join(dir, 'renders');
const files = fs.readdirSync(rendersDir).filter(f => /^r\d-.*\.html$/.test(f)).sort();

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

var styles = [], sections = [];
files.forEach(function (f, idx) {
  var html = fs.readFileSync(path.join(rendersDir, f), 'utf8');
  var id = 'd' + (idx + 1);
  var style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  var body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
    .replace(/<script id="fit">[\s\S]*?<\/script>\s*/g, '');
  styles.push(prefixCss(style, id));
  sections.push('<section id="' + id + '">' + body + '</section>');
});

var deck = [
  '<!doctype html>',
  '<html lang="es"><head>',
  '<meta charset="utf-8">',
  '<title>MotRest — Renders del producto</title>',
  '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
  '<style>',
  'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0B0D0E}',
  '#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;box-shadow:0 24px 80px rgba(0,0,0,.5)}',
  '#stage>section{display:none}',
  '#stage>section.active{display:block}',
  '#hud{position:fixed;right:28px;bottom:24px;display:flex;gap:10px;align-items:center;z-index:99}',
  "#hud button{border:0;border-radius:12px;padding:10px 18px;background:rgba(45,58,66,.9);color:#fff;font:600 16px 'Space Grotesk','Segoe UI',Arial,sans-serif;cursor:pointer}",
  '#hud button:hover{background:#F2853A}',
  "#count{color:#fff;background:rgba(45,58,66,.9);border-radius:12px;padding:10px 16px;font:600 15px 'Space Grotesk','Segoe UI',Arial,sans-serif}",
  '#bar{position:fixed;left:0;bottom:0;height:5px;background:#F2853A;width:0;transition:width .25s;z-index:99}',
  styles.join('\n'),
  '</style></head><body>',
  '<div id="stage">',
  sections.join('\n'),
  '</div>',
  '<div id="hud"><button id="prev" title="Anterior">&#8592;</button><span id="count"></span><button id="next" title="Siguiente">&#8594;</button><button id="fs" title="Pantalla completa">&#x26F6;</button></div>',
  '<div id="bar"></div>',
  '<script>',
  "var secs=[].slice.call(document.querySelectorAll('#stage>section')),i=0;",
  "function show(n){i=Math.max(0,Math.min(secs.length-1,n));secs.forEach(function(s,k){s.classList.toggle('active',k===i);});document.getElementById('count').textContent=(i+1)+' / '+secs.length;document.getElementById('bar').style.width=((i+1)/secs.length*100)+'%';}",
  "function fit(){var s=Math.min(innerWidth/1920,innerHeight/1080);document.getElementById('stage').style.transform='translate(-50%,-50%) scale('+s+')';}",
  "document.getElementById('next').onclick=function(){show(i+1);};",
  "document.getElementById('prev').onclick=function(){show(i-1);};",
  "document.getElementById('fs').onclick=function(){try{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();}catch(e){}};",
  "addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' ')show(i+1);else if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);else if(e.key==='Home')show(0);else if(e.key==='End')show(secs.length-1);});",
  "addEventListener('resize',fit);fit();show(0);",
  '</scr' + 'ipt></body></html>'
].join('\n');

fs.writeFileSync(path.join(dir, 'renders-deck.html'), deck);
console.log('OK: renders-deck.html generado con ' + files.length + ' renders.');

// rebrand-naranja
