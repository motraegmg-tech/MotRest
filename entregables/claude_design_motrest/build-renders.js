// Genera renders/rN-*.html (1920×1080): cada pantalla de producto/ montada en su
// dispositivo (tablet, monitor, laptop, teléfono) sobre fondo de marca.
// Las pantallas siguen siendo la fuente única. Ejecutar: node build-renders.js
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const outDir = path.join(dir, 'renders');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const RENDERS = [
  { src: 'p1-pos-mitad-y-mitad.html', out: 'r1-pos.html', device: 'tablet', k: 0.535, w: 1920, h: 1080,
    modulo: 'Módulo M1 · Punto de Venta y Servicio', titulo: 'Punto de venta — mitad y mitad',
    caption: 'Costeo por ingrediente en vivo mientras se toma la comanda: cada mitad de la pizza con su costo y su margen. Precios estimados, sujetos a la realidad de cada restaurante.' },
  { src: 'p2-kds-cocina.html', out: 'r2-kds.html', device: 'monitor', k: 0.546, w: 1920, h: 1080,
    modulo: 'Módulo M2 · Cocina (KDS) y Recetas', titulo: 'Cocina orquestada',
    caption: 'Cada estación sabe qué hacer y cuándo; los retrasos se ven antes de que duelan.' },
  { src: 'p3-dashboard-direccion.html', out: 'r3-dashboard.html', device: 'laptop', k: 0.514, w: 1920, h: 1080,
    modulo: 'Módulos M8–M9 · Inteligencia y Roles', titulo: 'Dirección — visión total',
    caption: 'Ventas, costos, margen y alertas del día en una sola pantalla, con el pronóstico al lado del dato real.' },
  { src: 'p4-menu-engineering.html', out: 'r4-menu-engineering.html', device: 'laptop', k: 0.514, w: 1920, h: 1080,
    modulo: 'Capacidad AI-first 02 · Menu Engineering', titulo: 'Menu engineering con IA',
    caption: 'La carta clasificada por margen y popularidad, con recomendaciones accionables del agente.' },
  { src: 'p5-centinela-mermas.html', out: 'r5-centinela.html', device: 'laptop', k: 0.514, w: 1920, h: 1080,
    modulo: 'Capacidad AI-first 05 · Centinela', titulo: 'Centinela de mermas',
    caption: 'Anomalías detectadas en tiempo real, correlacionadas con turno, estación y usuario.' },
  { src: 'p6-copiloto-whatsapp.html', out: 'r6-copiloto.html', device: 'phone', k: 0.835, w: 430, h: 932,
    modulo: 'Orquestación agéntica · Copiloto del Dueño', titulo: 'Copiloto del Dueño',
    caption: 'Tu restaurante responde por WhatsApp — solo con lo que tu rol puede ver.' }
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

function device(r, inner) {
  var sw = Math.round(r.w * r.k), sh = Math.round(r.h * r.k);
  var screen = '<div class="hw-screen" style="width:' + sw + 'px;height:' + sh + 'px">' +
    '<div class="hw-fit" style="width:' + r.w + 'px;height:' + r.h + 'px;transform:scale(' + r.k + ')">' + inner + '</div></div>';
  if (r.device === 'tablet') return '<div class="hw-dev hw-tablet">' + screen + '</div>';
  if (r.device === 'monitor') return '<div class="hw-devwrap"><div class="hw-dev hw-monitor">' + screen + '</div><div class="hw-neck"></div><div class="hw-base"></div></div>';
  if (r.device === 'laptop') return '<div class="hw-devwrap"><div class="hw-dev hw-laptop">' + screen + '</div><div class="hw-lapbase" style="width:' + (sw + 150) + 'px"></div></div>';
  return '<div class="hw-dev hw-phone"><div class="hw-notch"></div>' + screen + '</div>';
}

RENDERS.forEach(function (r, idx) {
  var html = fs.readFileSync(path.join(dir, 'producto', r.src), 'utf8');
  var id = 'r' + (idx + 1);
  var style = prefixCss(html.match(/<style>([\s\S]*?)<\/style>/)[1], id);
  var body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
    .replace(/<script id="fit">[\s\S]*?<\/script>\s*/g, '');
  var inner = '<div id="' + id + '">' + body + '</div>';

  var page = [
    '<!doctype html>',
    '<html lang="es"><head>',
    '<meta charset="utf-8">',
    '<title>Render · ' + r.titulo + ' — MotRest</title>',
    '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
    '<style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    'html,body{width:1920px;height:1080px;overflow:hidden}',
    "body{font-family:'Inter','Segoe UI',Arial,sans-serif;background:#14181A;color:#fff;position:relative}",
    '.hw-glow{position:absolute;width:1200px;height:1200px;border-radius:50%;background:radial-gradient(circle,rgba(242,133,58,.17) 0%,rgba(242,133,58,0) 62%);right:-320px;top:-380px}',
    '.hw-glow2{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(242,133,58,.10) 0%,rgba(242,133,58,0) 60%);left:-260px;bottom:-380px}',
    '.hw-stage{position:relative;z-index:1;width:1920px;height:1080px;display:flex;align-items:center;gap:80px;padding:0 110px}',
    '.hw-text{width:520px;flex:none}',
    ".hw-eyebrow{font-family:'Space Grotesk','Segoe UI',sans-serif;font-size:20px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:#F2853A}",
    ".hw-mod{display:inline-block;margin-top:22px;border:2px solid rgba(242,133,58,.55);border-radius:999px;padding:9px 20px;font-size:17px;font-weight:600;color:#FDEBD7}",
    ".hw-title{font-family:'Space Grotesk','Segoe UI',sans-serif;font-size:58px;font-weight:700;line-height:1.1;letter-spacing:-.01em;margin-top:22px}",
    '.hw-cap{font-size:23px;line-height:1.5;color:#B9C2BC;margin-top:20px}',
    ".hw-brand{position:absolute;left:110px;bottom:52px;font-size:20px;color:#8A969C;font-style:italic}",
    ".hw-brand b{color:#F2853A;font-style:normal;font-family:'Space Grotesk','Segoe UI',sans-serif;margin-right:12px}",
    '.hw-dev-area{flex:1;display:flex;align-items:center;justify-content:center}',
    '.hw-devwrap{display:flex;flex-direction:column;align-items:center}',
    '.hw-dev{background:#0B0D0E;border:2px solid #2A3237;box-shadow:0 40px 90px rgba(0,0,0,.55)}',
    '.hw-tablet{padding:26px;border-radius:38px}',
    '.hw-monitor{padding:20px;border-radius:22px}',
    '.hw-laptop{padding:18px 18px 22px;border-radius:24px 24px 0 0;border-bottom:0}',
    '.hw-phone{padding:14px;border-radius:52px;position:relative}',
    '.hw-notch{position:absolute;top:26px;left:50%;transform:translateX(-50%);width:120px;height:26px;background:#0B0D0E;border-radius:14px;z-index:2}',
    '.hw-neck{width:110px;height:64px;background:#0B0D0E;border:2px solid #2A3237;border-top:0}',
    '.hw-base{width:340px;height:18px;background:#0B0D0E;border:2px solid #2A3237;border-radius:10px}',
    '.hw-lapbase{height:26px;background:#171D21;border:2px solid #2A3237;border-radius:0 0 22px 22px}',
    '.hw-screen{overflow:hidden;border-radius:14px;background:#000}',
    '.hw-phone .hw-screen{border-radius:38px}',
    '.hw-fit{transform-origin:top left}',
    style,
    '</style></head><body>',
    '<div class="hw-glow"></div><div class="hw-glow2"></div>',
    '<div class="hw-stage">',
    '<div class="hw-text">',
    '<div class="hw-eyebrow">MOTRAE · MotRest</div>',
    '<div class="hw-title">' + r.titulo + '</div>',
    '<div class="hw-cap">' + r.caption + '</div>',
    '<span class="hw-mod">' + r.modulo + '</span>',
    '</div>',
    '<div class="hw-dev-area">' + device(r, inner) + '</div>',
    '</div>',
    '<div class="hw-brand"><b>MOTRAE</b>Innovation already in motion</div>',
    '<script id="fit">(function(){function f(){var s=Math.min(innerWidth/1920,innerHeight/1080);document.body.style.transform="scale("+s+")";}document.body.style.transformOrigin="top left";document.documentElement.style.overflow="hidden";document.documentElement.style.background="#14181A";window.addEventListener("resize",f);f();})();</scr' + 'ipt>',
    '</body></html>'
  ].join('\n');

  fs.writeFileSync(path.join(outDir, r.out), page);
});
console.log('OK: ' + RENDERS.length + ' renders generados en renders/.');

// rebrand-naranja
