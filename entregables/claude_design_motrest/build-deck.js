// Genera index.html (deck navegable) a partir de slides/NN-*.html y
// parchea cada lámina con un auto-escalado para que se vea completa
// en cualquier tamaño de tarjeta. Ejecutar: node build-deck.js
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const slidesDir = path.join(dir, 'slides');
const files = fs.readdirSync(slidesDir).filter(f => /^\d{2}-.*\.html$/.test(f)).sort();

const FIT = '<script id="fit">(function(){function f(){var s=Math.min(innerWidth/1920,innerHeight/1080);document.body.style.transform="scale("+s+")";}document.body.style.transformOrigin="top left";document.documentElement.style.overflow="hidden";document.documentElement.style.background=getComputedStyle(document.body).backgroundColor;window.addEventListener("resize",f);f();})();</scr' + 'ipt>';

// Prefija cada selector CSS con el id de la sección para poder
// convivir en un solo documento sin colisiones.
function prefixCss(css, id) {
  return css.replace(/([^{}]+)\{/g, function (_m, sel) {
    var out = sel.split(',').map(function (s) {
      s = s.trim();
      if (s === '*') return '#' + id + ', #' + id + ' *';
      if (s === 'html' || s === 'body' || s === ':root') return '#' + id;
      return '#' + id + ' ' + s;
    });
    // dedup (html,body -> #id,#id)
    return out.filter(function (v, k) { return out.indexOf(v) === k; }).join(',') + '{';
  });
}

var styles = [], sections = [];
files.forEach(function (f) {
  var p = path.join(slidesDir, f);
  var html = fs.readFileSync(p, 'utf8');
  // Parche idempotente: escala la lámina individual al tamaño de su marco
  if (html.indexOf('id="fit"') === -1) {
    html = html.replace('</body>', FIT + '\n</body>');
    fs.writeFileSync(p, html);
  }
  var id = 's' + f.slice(0, 2);
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
  '<title>MotRest — Presentación Comercial</title>',
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

fs.writeFileSync(path.join(dir, 'index.html'), deck);
console.log('OK: index.html generado con ' + files.length + ' laminas; laminas individuales parcheadas con auto-escalado.');

// rebrand-naranja
