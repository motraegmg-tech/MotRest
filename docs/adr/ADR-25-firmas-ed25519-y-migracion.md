# ADR-25 · Firmas Ed25519 y migración de licencias

**Estado:** aceptado · **Fecha:** agosto 2026 · **Decide:** Gonzalo (MOTRAE)

---

## Contexto

Licencias y manifiestos de actualización usaban HMAC-SHA256. HMAC es simétrico:
la misma cadena que verifica también firma. Como esa cadena se instalaba en cada
restaurante, quien leyera el entorno de un local podía emitir licencias y firmar
una actualización que toda la flota aceptaría.

No es un riesgo teórico de servidor: cada nuevo restaurante multiplica los
lugares desde los que se podía obtener la llave maestra.

## Decisión

1. MotRest usa **Ed25519** mediante WebCrypto nativo.
2. Hay **dos pares independientes**: licencias y publicaciones. Comprometer uno
   no permite firmar el otro.
3. Las privadas viven en MOTRAE Central, cifradas por Windows DPAPI. Las públicas
   se validan al empaquetar y se incrustan en el ejecutable del Hub.
4. La firma cubre el JSON canónico completo, excepto `firma`, con claves
   ordenadas. Ningún campo nuevo —incluidas las notas para el restaurante— queda
   fuera por olvido.
5. El manifiesto lleva un `publicado_ts` monótono y opcionalmente
   `version_minima_soportada`; el Hub rechaza manifiestos antiguos o revertidos.

## Migración obligatoria

Cambiar algoritmo invalida toda licencia HMAC anterior. Por eso el orden no es
negociable:

1. En Central, generar los pares Ed25519 y guardar/cotejar sus públicas.
2. Compilar el nuevo Hub con esas públicas incrustadas.
3. **Emitir y entregar la licencia Ed25519 de cada local mientras aún ejecuta su
   Hub anterior.** Guardarla junto a su base de datos.
4. Confirmar que cada archivo corresponde a su `sucursal_id`.
5. Solo entonces instalar el Hub nuevo.

Nunca se actualiza primero el Hub y se «arregla después» la licencia. Un Hub
Ed25519 con una licencia HMAC queda en estado `invalida`, deja de operar y no
acepta el acceso de soporte derivado de una licencia no verificada. No hay salida
remota segura desde ese estado.

Central detecta el objeto HMAC legado de `localStorage`; no intenta convertir un
secreto simétrico en una llave asimétrica. Conserva repositorio y hash de soporte,
ofrece generar los nuevos pares y borra el dato legado solo después de que DPAPI
confirmó el guardado.

## Consecuencias

**A favor**

- Extraer una pública de un restaurante no permite firmar nada.
- Una licencia y un manifiesto ya no comparten capacidad criptográfica.
- La cuenta de soporte sigue estando dentro de una licencia firmada.
- Un release viejo no puede congelar silenciosamente a un Hub que ya vio uno más
  reciente.

**Costo asumido**

- Las privadas requieren un respaldo DPAPI separado y control del perfil Windows.
- Rotar pares requiere nuevo instalador y reemisión coordinada.
- No hay compatibilidad criptográfica con licencias HMAC: se administra con el
  orden de despliegue anterior, no con una puerta trasera de compatibilidad.

## Alternativas descartadas

**Seguir con HMAC y esconder mejor la cadena.** Ocultarla en variables de
entorno, ofuscarla o llamarla `llavePublica` no cambia que cualquier verificador
puede firmar.

**Generar un par por restaurante.** Aísla mejor, pero hace la emisión y rotación
demasiado complejas para la primera flota. Los dos pares globales se revisarán
cuando haya control de altas y rotación de claves por `key_id`.

**Aceptar HMAC y Ed25519 de forma permanente.** Mantendría la llave maestra
simétrica instalada en cada local y convertiría la migración temporal en una
vulnerabilidad permanente.
