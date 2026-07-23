# Generadores de documentos

Los entregables en `.docx` se producen con código, no a mano.

La razón es práctica: cuando cambie un requisito del SAT o el PAC contratado
publique otros endpoints, el documento se regenera editando su fuente en vez de
rehacer el formato. Y así queda claro en el historial qué cambió y por qué.

## Cómo regenerar

Necesitan la librería `docx`, que **no** es dependencia del monorepo —no forma
parte del producto—. Se instala aparte:

```
mkdir /tmp/docs && cd /tmp/docs
corepack pnpm@9.15.0 init && corepack pnpm@9.15.0 add docx
node <ruta>/puesta-en-marcha-facturacion.mjs <salida.docx>
```

## Documentos

| Fuente | Entregable | Qué contiene |
|---|---|---|
| `puesta-en-marcha-facturacion.mjs` | `entregables/MOTRAE_MotRest_Puesta_en_Marcha_Facturacion.docx` | Los dos trámites que no dependen del software: obtener el CSD ante el SAT y contratar un PAC. Incluye custodia del certificado, criterios de selección del proveedor, plan de una semana y listas de verificación. |

## Al actualizarlos

Las cifras y los nombres de trámite del SAT cambian. Lo que está redactado como
verificable —vigencia de cuatro años, plazo de 72 horas para timbrar, el
artículo 17-H Bis— conviene confirmarlo antes de reemitir el documento a un
cliente.
