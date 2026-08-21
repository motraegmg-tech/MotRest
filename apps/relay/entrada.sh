#!/bin/sh
# Arranque del contenedor: preparar el volumen y dejar de ser root.
#
# POR QUÉ HACE FALTA UN ENTRYPOINT PARA ESTO
#
# El volumen de Fly llega vacío y propiedad de root, y se monta ENCIMA de lo que
# hubiera en /datos, así que un `chown` en el Dockerfile no sirve de nada: lo
# tapa el montaje. Hay que ajustarlo cuando el volumen ya está puesto, y eso es
# aquí.
#
# Y POR QUÉ NO SE QUEDA COMO ROOT
#
# Dentro de /datos están los tokens de la API de Meta de todos los restaurantes.
# El relay es el único proceso de MotRest expuesto a internet: si algún día
# alguien encuentra la forma de ejecutar algo dentro, la diferencia entre ser
# `node` y ser root es la diferencia entre un incidente y una tarde muy larga.
#
# `exec su-exec` conserva el PID 1, que es lo que hace que el proceso reciba el
# SIGTERM de Fly al desplegar en vez de morir de golpe pasado el plazo.
set -e

mkdir -p /datos
# Recursivo a propósito: si alguna vez se corrió el CLI del padrón como root
# —que es como entra `fly ssh console`—, el archivo quedó con dueño root y el
# relay no podría leerlo. Esto lo devuelve a su sitio en el siguiente arranque
# en vez de dejar el padrón ilegible hasta que alguien lo investigue.
chown -R node:node /datos
# El padrón se guarda 0600 y su carpeta 0700; se repone aquí porque el volumen
# recién creado viene 0755 y ahí dentro no hay nada que deba ver nadie más.
chmod 700 /datos

exec su-exec node "$@"
