# Remediación de seguridad — estado y plan

> **Para quien retome este trabajo (persona o IA).** Este documento es la fuente
> de verdad del operativo. Al terminar cada etapa, **actualízalo**: marca la
> etapa, anota lo que se desvió del plan y por qué. Un plan que no refleja lo
> hecho es peor que no tenerlo.

**Origen:** auditoría `/cyber-neo` del 6-ago-2026 — 46 hallazgos (1 crítico, 10
altos, 20 medios, 12 bajos, 4 info) sobre 345 archivos fuente.
**Reporte completo:** `Escritorio/cyber-neo-report-Software_para_Restaurantes_ERP-2026-08-06.md`
**Rama:** `feature/e1-cimientos` · **Un commit por etapa.**

---

## Estado

| Etapa | Qué cubre | Estado |
|---|---|---|
| **1** | Herramientas y red de seguridad | ✅ `ce11047` |
| **2** | Identidad del Hub y registro a archivo | ✅ `2b59b55` |
| **3** | Credenciales del local | ✅ *(este commit)* |
| **4** | Cimientos criptográficos (Ed25519) | ⬜ **siguiente** |
| **5** | El Hub como autoridad | ⬜ |
| **6** | Superficie HTTP del Hub | ⬜ |
| **7** | El relay | ⬜ |
| **8** | Correo (CRLF) | ⬜ |
| **9** | Tauri, certificados y empaquetado | ⬜ |
| **10** | Proceso y despliegue (CI, guías) | ⬜ |
| **11** | Detalles finos | ⬜ |
| **12** | Capacitor 8 *(aislada)* | ⬜ |

**Pruebas al cierre de la etapa 3:** 1 466 verdes · lint 0 errores.

---

## Cómo está ordenado, y por qué importa

No es por severidad. Es un orden donde **ningún arreglo obliga a rehacer otro**,
derivado de restricciones verificadas en el código:

1. **Las herramientas primero.** Subir `vitest` cambia el corredor de pruebas →
   etapa 1, para que las once siguientes se validen sobre el toolchain final.
2. **`registrar()` es el cuello de botella único del Hub**: 46 llamadas directas
   + 10 puntos de inyección + 24 indirectas. Cambiar su firma se hace **antes que
   nada o nunca** → etapa 2.
3. **`sucursalDelLocal()` alimenta** el `hola` del relay, la atribución del
   portal y el stream de identidad → identidad estable antes de las etapas 5, 6 y 7.
4. **Lo que cambia la firma va junto.** Ed25519 + firmar `notas` + anti-reversión
   tocan los tres el contenido firmable → una etapa atómica. Separarlas
   cambiaría el formato 3 veces y reescribiría 6 archivos de prueba 3 veces.
5. **Lo arriesgado, aislado y al final** → Capacitor 8, etapa 12.

---

## ✅ Etapa 1 · Herramientas y red de seguridad

**Hallazgos:** CN-002, CN-010, CN-012, CN-029, CN-030, CN-038, CN-040, CN-041, CN-042

- `vitest` 2.1.9 → 3.2.7 en los 7 `package.json`. Cerró el crítico **y** los tres
  avisos de `vite@5.4.21`, que entraba solo como dependencia interna de vitest 2.
- `pnpm.overrides` += `postcss ^8.5.26`, `brace-expansion ^2.1.4`.
- **`pnpm audit` completo limpio**, no solo `--prod`.
- `.npmrc` con registro explícito y `frozen-lockfile`; script `auditoria`.
- `.gitignore` por **extensión** además de por ruta (`*.cer`, `*.p12`, `*.pass`…).
- **CN-002:** `atender()` envuelto en `try/catch` → 400; `decodificar()` defensiva;
  la URL se construye con base fija en vez del `Host` del cliente;
  `uncaughtException` y `unhandledRejection` que **anotan y no matan**;
  supervisión del sidecar en `lib.rs` con espera creciente.

**Decisión de diseño registrada:** el Hub **no muere** ante una excepción no
capturada. Para casi cualquier programa eso sería incorrecto, pero aquí el
proceso es el registro de ventas de un restaurante lleno: un fallo aislado en una
petición no justifica dejar de cobrar. El event log está en disco y cada petición
es independiente.

---

## ✅ Etapa 2 · Que el Hub sepa quién es y deje rastro

**Hallazgos:** CN-019, CN-031, CN-036 · **más un fallo hallado al explorar**

- **Identidad estable.** `sucursalDelLocal()` aprendía de los últimos 5 eventos
  con caída al literal `"suc-local"` → **dos Hubs recién instalados colisionaban**
  y el segundo desplazaba el enlace del primero en el relay. Ahora se resuelve una
  vez (archivo → entorno → registro) y se persiste en `<datos>/sucursal.txt`.
  Sin ninguna de las tres se genera uno **único**, no un literal compartido.
- **CN-019.** `registrar()` escribe a `<datos>/registro/hub-AAAA-MM-DD.log`,
  `mode 0600`, rotación por tamaño, retención 30 días. Los `error` a **stderr**.
  Nunca tumba el Hub: si el disco está lleno se pierde el renglón, no la venta.
- **CN-031.** La clave del local va enmascarada en la consola.
  `MOTREST_MOSTRAR_CLAVE=1` para verla.
- **CN-036.** El modo abierto se publica como catálogo `modo_abierto` y el POS
  pinta una banda roja permanente.

**Por qué CN-019 y CN-031 iban juntos:** al darle destino en disco al registro,
la clave del local habría quedado escrita sin caducidad.

---

## ✅ Etapa 3 · Credenciales del local

**Hallazgos:** CN-007, CN-008

- **Nada del repositorio abre ningún restaurante.** El propietario se siembra
  **sin credenciales** en producción; el primer arranque genera una contraseña
  (`7KX9-MQ2P-4VN8`, ~58 bits) y un PIN de **8 dígitos**, únicos de ese local, y
  los enseña **una sola vez** (`CredencialesIniciales.svelte`).
- Las credenciales de demostración viven dentro de `credencialesDeDemostracion()`
  —una **función**, no constantes de módulo— para que el empaquetador las
  elimine. Es la misma técnica que ya protegía a Marco y Lucía.
- Alfabeto sin `0/O`, `1/I/L` ni `U`: esto se apunta en papel y se dicta por
  teléfono.

### ⚠ Desviación deliberada del plan

El plan decía **«subir el mínimo a 6 dígitos en `validarSecreto()`»**. **No se
hizo, y es intencional.**

La vulnerabilidad real era **el hash publicado en el instalador**: con 10 000
combinaciones se rompe offline en segundos. Quitado el hash del paquete, un PIN
de 4 dígitos solo se puede atacar **en línea**, donde aplica el tope de 7
intentos — el mismo modelo que una tarjeta bancaria.

Subir a 6 para todos costaría dos dígitos más × cien tecleos por turno × cada
mesero, a cambio de defensa contra un atacante que ya tiene el dispositivo
—escenario que cubren BitLocker (etapa 10) y el bloqueo—.

**Lo que sí se hizo:** el PIN **generado** del propietario es de 8 dígitos. Es el
que firma cancelaciones, descuentos y retiros, y nadie lo teclea a diario.

*Si se prefiere el mínimo de 6 para todos, o un mínimo por rol (4 para piso, 6+
para quien puede autorizar), es un cambio de una línea en `validarSecreto` más el
ajuste de las pruebas que usan PIN de 4.*

---

## ⬜ Etapa 4 · Los cimientos criptográficos — **la siguiente**

**Hallazgos:** CN-001 *(crítico)*, CN-005, CN-023, CN-024, CN-025, CN-039

**Superficie verificada:** 11 archivos de producción, 6 de prueba, 5 documentos.
**No existe ningún helper de firma asimétrica reutilizable** — el único formato
asimétrico del repo es RSA con `node:crypto` para el CSD, que no sirve de
plantilla porque Central corre en navegador.

### El problema

Licencias y actualizaciones se firman con **HMAC-SHA256**, que es simétrico: la
llave que verifica **es** la que firma. Y se instala en cada restaurante
(`MOTREST_LICENCIA_LLAVE`, `MOTREST_ACTUALIZACIONES_LLAVE`).

Cualquiera con lectura del entorno de **un solo** local puede emitirse licencias
y **firmar una actualización que todos los demás Hubs aceptan** → ejecución de
código en toda la flota. El parámetro se llama `llavePublica` y **no lo es**;
ese nombre es probablemente el origen del error.

### Los pasos

1. **Helper nuevo** en `packages/dominio/src/comun/firma.ts`: `generarPar()`,
   `firmar()`, `verificar()` sobre Ed25519 con WebCrypto (nativo en Node 20+,
   cero dependencias). `subtle.verify` ya es de tiempo constante → la comparación
   manual actual desaparece.
2. **Contenido firmable rehecho una sola vez**: JSON canónico del objeto completo
   sin `firma`, claves ordenadas. Arregla de un golpe: `notas` fuera de la firma
   (CN-023); `join("|")` **sin escape** (un `nombre` con `|` permite colisiones);
   y la ambigüedad entre `soporte` ausente y `soporte` vacío, que hoy producen la
   misma cadena.
3. **Dos pares distintos** (licencias / publicación). La privada nunca sale de
   Central; en los Hubs va la **pública incrustada en el binario**.
4. **Central** (CN-005): `generar()` pasa a `subtle.generateKey`; la UI debe
   **mostrar y copiar la pública**, ocultar la privada; secretos al almacén del
   sistema (DPAPI) vía comando Rust. **Ruta de migración obligatoria:** ya hay
   una Central configurada con el formato viejo — leerlo y ofrecer regenerar, no
   reventar. Y `respaldoDeSecretos()` se cita dos veces en comentarios **y no
   existe**: implementarlo o quitar la referencia.
5. **CLI** `emitir-licencia.ts`: la auto-verificación tras emitir necesita
   **derivar la pública de la privada**.
6. CN-024 (`publicado_ts` monótono + frescura + `version_minima_soportada`),
   CN-025 (`authorization` solo a hosts de GitHub, exigir `https:`), CN-039
   (`mkdtemp` + revalidar SHA-256 **desde disco** antes del `spawn`).
7. **6 archivos de prueba** usan la llave como cadena arbitraria → par en
   `beforeAll`. Dos firman con «secreto de atacante»: con asimétrica hay que
   firmar con **otra llave privada**, no con otra cadena.

### ⚠ El auto-bloqueo

Cambiar el algoritmo **invalida todas las licencias emitidas**. Un Hub
actualizado a Ed25519 **antes** de recibir su licencia reemitida queda
`invalida` → `opera:false` → **bloqueado y sin acceso de soporte para
arreglarlo**, porque `credencialDeSoporte` exige `licenciaVerificada`. No se sale
en remoto.

**Rodizio no está instalado**, así que hoy el riesgo es **cero**. Desde el primer
despliegue: **emitir la licencia nueva antes de actualizar el Hub, nunca al
revés.** Debe quedar en un ADR.

---

## ⬜ Etapa 5 · El Hub como autoridad

**Hallazgos:** CN-003, CN-013 · **tres trampas halladas al explorar**

Hoy `revalidarPermiso` falla **abierto** y `main.ts` construye el Hub sin
`usuarioDe`. El mecanismo **está probado** en `sincronizacion.test.ts` y
`fiscal-canal.test.ts` — solo está desconectado. Coste ya pagado: **hoy nadie
puede administrar el CSD por el canal**, porque `puedeAdministrarCsd` sí falla
cerrado (es la pauta correcta a replicar).

**⚠ Trampa 1 — la semilla.** `USUARIOS_SEMILLA` vive en `pos-ui` y el Hub no
tiene ruta de importación. Peor: **el propietario no existe en ningún event log**.
Con proyección vacía sale `undefined` y **el Hub rechazaría cada cobro del dueño**.
→ Que el POS emita `usuario_creado` para la semilla en el primer arranque.

**⚠ Trampa 2 — el hueco circular.** Ningún evento de identidad está en
`PERMISO_POR_EVENTO`. Si el Hub deriva usuarios del log sin cerrar esto, un
cliente empuja `usuario_creado` con `rol_id:"propietario"` y se auto-eleva. **Van
juntas o no van.**

**⚠ Trampa 3 — la proyección.** `porTipo` **no tiene índice** (recorrido completo,
6 veces, límite 200) → usar `leerStream(streamIdentidad(...))`.
`revalidarPermiso` es **síncrona** y `leerStream` asíncrona → proyección **en
memoria**, construida en `arrancar()` y actualizada incrementalmente.
`aplicarEventoIdentidad` tiene un `default` con `never` que **devuelve el evento
como si fuera el estado** → filtrar estrictamente a los 11 tipos.

**CN-013:** `recibirCatalogos` no reserva claves → una terminal publica
`licencia_estado` con `version:999999`, el Hub lo **persiste y lo difunde** como
suyo y **sobrevive al reinicio**.

---

## ⬜ Etapas 6 a 12 — resumen

| Etapa | Hallazgos | Lo que hay que saber |
|---|---|---|
| **6** HTTP del Hub | CN-012, CN-014, CN-017, CN-032, **CN-047**, **CN-048** | `/portal/api/*` manda `Access-Control-Allow-Origin: *` **literal** (CN-047) · `permitirCorsCaja` acepta **puerto arbitrario** en localhost (CN-048) · **8 rutas**, no 7: `/arranque-automatico` no estaba en la auditoría · `/kiosco` sin barra cae al fallback de estáticos · **no hay ningún límite de ritmo** en toda la superficie |
| **7** Relay | CN-004, CN-006, CN-034, **CN-049** | **No existe ningún flujo de alta**: `darDeBaja()` no tiene llamadores y el padrón se puebla por auto-registro. Hay que **inventar el alta** antes de poder tener credencial por inquilino · `sucursalId` es **reasignable en la misma conexión** · `conectar()` sobrescribe sin cerrar, y al desconectarse el impostor **borra el enlace del legítimo** · `guardar()` **no es atómico** · `/salud` expone el padrón sin auth (CN-049) |
| **8** Correo | CN-011 | `cabecera()` no detecta `\r\n` porque están en `\x00-\x7F`. El `nombre` de la reserva viene del **portal público sin filtro** |
| **9** Tauri y empaquetado | CN-015, CN-016, CN-018, CN-026, CN-033, CN-035, CN-037 | `shell:default` **nada lo usa**: `pos-ui` no depende de `@tauri-apps/api` y no hay un solo `invoke` · el certificado del Hub se genera como **CA** · `mode 0o600` **no protege en NTFS** — la protección real son las ACL |
| **10** Proceso | CN-009, CN-021, CN-022, CN-028 | **Bloqueado parcialmente:** la compra del certificado Authenticode es trámite comercial. Dejar `certificateThumbprint` y la verificación antes del `spawn` listos |
| **11** Detalles | CN-043, CN-044 | Sesgo de módulo en base32 (78,3 bits reales, no 80) · `cargo-audit` no instalado: 860 crates sin contrastar |
| **12** Capacitor | CN-027 | Aislada al final: **único cambio que solo se comprueba en una tablet física** |

---

## Verificación

Al terminar **cada** etapa:
```bash
corepack pnpm@9.15.0 -r test
corepack pnpm@9.15.0 -r lint
```

**Y la que de verdad cuenta — sobre el paquete compilado, no sobre el código.**
Es la que atrapó que «Gonz Motrae» no existía en producción con doce pruebas
verdes: el empaquetador elimina lo que nadie llama, y ninguna prueba lo detecta.

```bash
corepack pnpm@9.15.0 --filter pos-ui build
grep -a "MotRest.Inicio" apps/pos-ui/dist/assets/*.js    # etapa 3: debe estar ausente
grep -a "usr-marco"      apps/pos-ui/dist/assets/*.js    # demo: debe estar ausente

# Lo que entra al instalador es el installer.nsi, NO el árbol de compilación:
grep -oE 'oname=pos.assets.index-[A-Za-z0-9_-]+\.js' \
  $CARGO_TARGET_DIR/release/nsis/x64/installer.nsi        # exactamente uno
```

> `$CARGO_TARGET_DIR/release/pos` puede acumular bundles viejos de compilaciones
> antiguas y **engañar**. Tauri 2 lee directo de `apps/pos-ui/dist`.

---

## Notas de entorno

- **pnpm no está en el PATH.** Siempre `corepack pnpm@9.15.0`.
- **Compilar Rust fuera de `Documents`**: `CARGO_TARGET_DIR=C:/motrest-build`.
  Defender bloquea los objetos y falla con `os error 32`.
- No hay `semgrep`, `trivy`, `gitleaks` ni `cargo-audit` instalados.

---

## Fuera de alcance

| Punto | Motivo |
|---|---|
| Compra del certificado Authenticode | Trámite comercial. Todo lo demás cableado |
| Reserva del scope `@motrest` en npm | Requiere cuenta. El `.npmrc` ya está |
| Marketplace de comensales / funciones de red | PRD, «post-F4»: requiere masa crítica |
