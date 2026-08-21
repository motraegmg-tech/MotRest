# La imagen del relay: Node y dos archivos.
#
# El relay es lo único de MotRest que da a internet, así que la imagen que se
# publica lleva lo justo para atender. El monorepo, TypeScript, tsx, vitest y
# las fuentes de los demás paquetes se quedan en la etapa de construcción y no
# viajan: nada de eso hace falta para enrutar un webhook, y todo eso sería
# superficie de ataque en el sitio donde menos conviene tenerla.
#
# Se construye desde la RAÍZ del monorepo, no desde esta carpeta:
#
#   docker build -f apps/relay/Dockerfile .
#
# `fly deploy` ya lo hace así porque el fly.toml lo dice. Y lo construye en el
# servidor de Fly, así que en la máquina de MOTRAE no hace falta Docker.

# ---------------------------------------------------------------------------
# 1. Construcción
# ---------------------------------------------------------------------------
# La versión es la de .nvmrc, exacta y no `24-alpine`. En este proyecto el Node
# que corre las cosas es una decisión, no un detalle: el Hub del restaurante se
# empaqueta con la versión exacta y aborta si no coincide. El relay no puede ser
# el componente que se actualiza solo el día que Docker refresque una etiqueta.
FROM node:24.16.0-alpine AS constructor

# Corepack, sin terminal, se para a pedir confirmación antes de bajar pnpm. En
# un build no hay terminal: sin esto se queda colgado y el error no dice por qué.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /origen

# Se copia el monorepo entero (menos lo que excluye .dockerignore) porque el
# relay usa `@motrest/dominio` por `workspace:*` y pnpm resuelve ese protocolo
# ESTRICTAMENTE dentro del workspace: sin el paquete presente, falla en vez de
# caer al registro público. Eso es exactamente lo que queremos que pase.
COPY . .

# `--filter @motrest/relay...` instala el relay y sus dependencias del workspace,
# y nada más. El lockfile va congelado: la máquina que construye no elige
# versiones, las obedece.
RUN corepack pnpm@9.15.0 install --frozen-lockfile --filter @motrest/relay... \
 && corepack pnpm@9.15.0 --filter @motrest/relay empaquetar

# ---------------------------------------------------------------------------
# 2. Lo que se publica
# ---------------------------------------------------------------------------
FROM node:24.16.0-alpine

# `su-exec` deja bajar de root a `node` en el arranque conservando el PID 1.
# Hace falta por el volumen: ver entrada.sh.
RUN apk add --no-cache su-exec

WORKDIR /app

# Los dos archivos y nada más. Ni node_modules: `ws` va dentro del bundle.
COPY --from=constructor /origen/apps/relay/dist/relay.cjs /origen/apps/relay/dist/padron.cjs ./
COPY apps/relay/entrada.sh apps/relay/padron /usr/local/bin/

# El bit de ejecución se pone aquí y no se hereda del repositorio: en Windows no
# existe, y quien clone en Windows produciría una imagen que no arranca.
RUN chmod +x /usr/local/bin/entrada.sh /usr/local/bin/padron

# El padrón, los pulsos y el buzón de licencias van al volumen, que es lo único
# que sobrevive a un despliegue. Si estas rutas apuntaran al disco de la máquina,
# cada `fly deploy` borraría el padrón de todos los restaurantes — y las
# renovaciones que sus locales todavía no hubieran recogido.
ENV MOTREST_RELAY_PADRON=/datos/restaurantes.json \
    MOTREST_RELAY_PULSOS=/datos/pulsos.json \
    MOTREST_RELAY_LICENCIAS=/datos/licencias.json \
    MOTREST_RELAY_PUERTO=8080 \
    NODE_ENV=production

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrada.sh"]
CMD ["node", "/app/relay.cjs"]
