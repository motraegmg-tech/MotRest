# ADR-27 · Dónde vive el relay

**Estado:** aceptado · **Fecha:** agosto 2026 · **Decide:** Gonzalo (MOTRAE)

---

## Contexto

El relay estaba escrito, probado y documentado, y **no existía en ninguna
parte**. Es la única pieza de MotRest que necesita un servidor de verdad —
webhook público con HTTPS y un WebSocket abierto contra cada Hub (ADR-23)— y
mientras no estuviera publicada, dos cosas quedaban bloqueadas:

1. **WhatsApp**, entero: Meta no acepta un webhook sin certificado válido.
2. **Los pulsos**, que es lo que hace que MOTRAE sepa qué versión corre cada
   restaurante y cuál lleva dos días caído (ADR-26). Sin eso se publica a
   ciegas.

El código no necesitaba nada; faltaba decidir dónde corre, cómo se empaqueta y
qué se puede prometer de él. Este ADR es esa decisión.

## Decisión 1 — Fly.io, en Querétaro, con un volumen

Lo que el relay exige del sitio donde viva es concreto y descarta a casi todos:
**HTTPS gestionado**, **WebSockets de larga duración** y **un disco que
sobreviva a los despliegues**. Fly.io da los tres sin administrar un servidor.

La máquina va en **Dallas (`dfw`)**, que es lo más cerca de México que llega Fly:
no tiene región mexicana, así que la elección real era Dallas o Los Ángeles.
Importa porque el enlace con cada Hub está abierto todo el día y cada salto de
más es un tramo que se puede cortar.

El volumen guarda dos archivos: el padrón cifrado y los pulsos. Que el disco sea
explícito y montado en `/datos` no es un detalle de despliegue: es la frontera
de lo que MOTRAE tiene en internet, y conviene poder señalarla con el dedo.

## Decisión 2 — Una sola instancia, y por qué eso está bien

**El relay no se replica.** Los enlaces de los Hubs viven en memoria, el padrón
es un archivo en el volumen y el índice de mensajes ya vistos —el que evita
procesar dos veces un reintento de Meta— también. Dos máquinas serían dos
padrones divergiendo y la mitad de los avisos llegando a un relay donde el Hub
de ese local no está conectado.

Escalar horizontalmente no es "subir el número": exige antes sacar ese estado a
un sitio compartido. Mientras eso no pase, subirlo lo rompe **en silencio**, que
es la peor forma de romperse.

Con una máquina caben todos los restaurantes previsibles: el relay enruta
mensajes y no calcula nada, y lo que consume es memoria por socket abierto. El
día que deje de valer se sabrá por la memoria, no por la CPU.

**Lo que se pierde con esta decisión es la alta disponibilidad**, y se acepta
porque el sistema ya está diseñado para ello: si el relay se cae, el restaurante
sigue vendiendo. Se pierden avisos de WhatsApp, no la operación.

## Decisión 3 — Se publica un binario, no el monorepo

En desarrollo el relay corre con `tsx src/main.ts`. Llevar eso al servidor
significaría meter TypeScript, tsx, vitest y las fuentes de todos los paquetes
en el único componente expuesto a internet. La imagen lleva **Node y dos
archivos**: el servicio y el CLI del padrón, juntados con esbuild igual que ya se
hace con el Hub.

El CLI viaja con él porque el padrón está cifrado con una llave que solo existe
en el entorno del servidor: dar de alta un restaurante se hace **dentro** de la
máquina, no desde la computadora de nadie.

Y el proceso **no corre como root**. Ahí dentro están los tokens de la API de
Meta de todos los restaurantes; si algún día alguien consigue ejecutar algo en
esa máquina, la diferencia entre ser `node` y ser root es la diferencia entre un
incidente y una tarde muy larga.

## Decisión 4 — Dominio de MOTRAE, desde el primer día

El relay se publica en `relay.<dominio de MOTRAE>` y no en el subdominio que
regala el proveedor, aunque Meta acepte cualquiera de los dos.

La razón no es la marca: esa dirección queda escrita **dentro de la
configuración de cada Hub instalado**. Cambiarla después es visitar restaurante
por restaurante, o mandar una actualización cuyo único fin es corregir una URL.
Un dominio propio también permite mudar de proveedor sin que ningún local se
entere.

## Consecuencias

- Aparece el **primer costo recurrente** del producto: unos 4 USD al mes para
  toda la cartera, no por local. Sigue siendo el único componente que se paga
  todos los meses y el único expuesto a internet.
- **Cada despliegue corta los enlaces.** Los Hubs vuelven solos con reconexión
  progresiva, pero desplegar tiene hora: no un viernes por la noche.
- **El respaldo son dos piezas separadas** —la llave, en el entorno; el padrón,
  en el volumen— y hay que guardarlas en sitios distintos. Juntas son el padrón
  en claro; por separado no valen nada. Esa incomodidad es el diseño.
- Queda una dependencia de un proveedor. Se acota con el dominio propio y con
  que lo que corre ahí es una imagen de Docker corriente: mudarla es mover un
  archivo cifrado y apuntar un DNS.

## Alternativas descartadas

- **Supabase Edge Functions / Cloudflare Workers.** Es donde la plataforma de
  MOTRAE ya vive, y no sirve para esto: son ejecuciones efímeras sin disco
  propio, y el relay necesita sostener un socket abierto por restaurante y un
  padrón que no puede vivir en la base de datos de nadie más.
- **Un VPS propio (Hetzner, DigitalOcean).** Más control y prácticamente el
  mismo precio, a cambio de que las actualizaciones del sistema operativo, el
  certificado y el arranque automático pasan a ser trabajo de MOTRAE. En la
  máquina que da a internet, ese es exactamente el trabajo que no conviene
  tener pendiente.
- **Railway.** Despliega más rápido desde el repositorio y cuesta más al crecer,
  con menos control sobre dónde queda el disco.
- **Varias réplicas desde el principio.** Sería prepararse para un problema que
  no existe, rompiendo hoy el enrutamiento por un Hub que está conectado a la
  otra máquina.
- **Seguir sin publicarlo hasta que Meta apruebe la app.** Era lo que ya estaba
  pasando, y dejaba los pulsos sin recoger: dos cosas bloqueadas por una espera
  que solo afecta a una.
