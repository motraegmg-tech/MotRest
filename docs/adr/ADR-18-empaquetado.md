# ADR-18 — Empaquetado: qué se instala en cada equipo del local

**Estado:** aceptado · **Fecha:** 2026-07-22 · **Etapa:** 12

## Contexto

F1 se cierra con *"un instalador que un tercero instala solo"* y la métrica del
PRD §9: *"un servicio de viernes completo en Rodizio, sin papel y sin internet"*.

Hasta ahora el local se levanta con comandos desde una terminal de desarrollo.
Eso funciona para probar, no para vender.

Hay además un problema concreto que arrastramos desde la etapa 10 y que el
empaquetado tiene que resolver: **el aviso del certificado**. Los navegadores
solo exponen `crypto.subtle` en contextos seguros, el Hub vive en una LAN sin
dominio, y un certificado autofirmado obliga a cada terminal a saltarse una
advertencia roja. Acostumbrar al personal de un restaurante a ignorar avisos de
seguridad es un mal resultado, aunque "funcione".

## Decisión

Tres artefactos, uno por tipo de equipo:

| Equipo | Artefacto | Qué incluye |
|---|---|---|
| **Caja** (el equipo del Hub) | Instalador de Windows (Tauri) | POS + Hub + arranque automático |
| **Tablets de piso** | La misma app de escritorio, o el navegador | POS apuntando al Hub del local |
| **Pantalla de cocina** | APK (Capacitor) en modo kiosco | KDS a pantalla completa |

### Por qué el instalador de la caja lleva TAMBIÉN el Hub

El criterio de aceptación dice "instala solo". Un instalador que deje al
restaurantero configurando un servicio aparte no lo cumple. La caja es un único
equipo por local, así que empaquetar las dos piezas juntas no duplica nada.

### Por qué una app nativa y no solo el navegador

No es por rendimiento ni por estética: es por el **contexto seguro**. Una app
Tauri corre en un origen que el navegador considera seguro por definición, así
que `crypto.subtle` funciona sin certificado y sin advertencias. El mismo POS,
abierto en un navegador por la IP del local, no puede ni verificar una
contraseña.

## Sobre el aviso del certificado en las tablets

La app de escritorio en la caja no lo sufre —habla con el Hub por `localhost`,
que los navegadores tratan como seguro—. Una tablet, en cambio, habla con el Hub
por la red y ahí el certificado autofirmado vuelve a aparecer.

Tres caminos, en orden de calidad:

1. **Fijar el certificado en la app (pinning).** El QR de emparejamiento ya
   podría llevar la huella del certificado del Hub, y la app aceptar
   exactamente ese y ningún otro. Sin advertencia y **más seguro que confiar en
   una autoridad pública**, porque acepta un solo certificado concreto. Exige
   mover el canal de sincronización al lado nativo de la app, donde se controla
   la validación — es trabajo real y es el camino correcto.
2. **Instalar el certificado del Hub** en cada tablet, una vez. Sin advertencia,
   pero es un trámite manual por dispositivo cada vez que se cambia el Hub.
3. **Aceptar la advertencia una vez** por tablet. Es lo que hay hoy. Funciona,
   pero enseña el hábito que queremos evitar.

**Se elige (1) como destino y se documenta (3) como estado actual.** No se
implementa (1) en esta etapa para no retrasar el resto del empaquetado, y porque
requiere reescribir el transporte en el lado nativo.

## Cómo se empaqueta el Hub

El Hub es TypeScript sobre Node. Para que quepa en un instalador se junta con
esbuild en un solo archivo y se incrusta dentro de una copia de `node.exe`
(*Single Executable Application*). Pesa ~91 MB porque lleva el motor de Node
dentro; es el precio de que la máquina destino no necesite nada instalado.

Eso obligó a un cambio en el código: **no puede haber `await` en el nivel
superior del módulo**, porque el empaquetado no lo admite. El arranque pasó a
una función `arrancar()`, que además deja explícito el orden de encendido.

## Consecuencias

- El instalador de la caja hace innecesario `instalar-servicio.ps1`, que se
  conserva para instalaciones donde el Hub va en un servidor sin interfaz.
- La app de escritorio y el navegador comparten exactamente el mismo POS
  compilado: no hay dos versiones que mantener.
- El APK del KDS es la única pieza con su propio ciclo de publicación.
- Queda abierto el pinning de certificado, que es lo que cerraría del todo el
  frente de las advertencias.

## Alternativas descartadas

**Electron en vez de Tauri.** Empaqueta su propio Chromium: ~150 MB por
instalador frente a ~10 MB, y una superficie de actualización mucho mayor en
equipos que un restaurante no parchea. Tauri usa el WebView2 que Windows ya
trae.

**Una PWA instalable en vez de app nativa.** No resuelve el problema del
certificado —sigue siendo el navegador— y no puede arrancar el Hub. Sí es buena
opción para la carta del comensal y para demostraciones, donde no hay operación
crítica ni Hub local que alcanzar.

**Que el POS de la caja siga en el navegador.** Es lo que hay hoy y funciona
por `localhost`, pero deja al restaurantero arrancando el Hub a mano y abriendo
una URL larga cada mañana.
