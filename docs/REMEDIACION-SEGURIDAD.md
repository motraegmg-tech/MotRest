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
| **4** | Cimientos criptográficos (Ed25519) | ✅ *(este commit)* |
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

## ✅ Etapa 4 · Los cimientos criptográficos

**Hallazgos cerrados:** CN-001 *(crítico)*, CN-005, CN-023, CN-024, CN-025,
CN-039.

- **Firmas asimétricas reutilizables.** `packages/dominio/src/comun/firma.ts`
  implementa Ed25519 con WebCrypto nativo. Licencias y manifiestos usan un JSON
  canónico de todo el objeto salvo `firma`, con claves ordenadas: `notas`,
  `version_minima_soportada` y cualquier campo anidado quedan cubiertos por la
  firma.
- **Separación de autoridad.** Hay un par para licencias y otro para
  publicaciones. Central conserva las privadas protegidas por DPAPI; Hub recibe
  solamente las públicas, incrustadas por `empaquetar.mjs`. El empaquetado exige
  `MOTREST_LICENCIA_PUBLICA` y `MOTREST_ACTUALIZACIONES_PUBLICA`, por lo que no
  puede producirse accidentalmente un binario de producción sin sus verificadores.
- **Central y migración.** La UI ya no muestra ni persiste privadas en
  `localStorage`; enseña y permite copiar solo las públicas. Los comandos Tauri
  protegen secretos y sus respaldos cifrados con DPAPI. Si encuentra la
  configuración HMAC heredada, conserva la configuración no sensible y ofrece
  regenerar los pares, sin impedir que Central abra. Se implementaron también
  respaldo y restauración de secretos cifrados.
- **Operación de licencias.** El CLI recibe la privada desde el almacén seguro de
  MOTRAE, deriva su pública y auto-verifica antes de emitir. Ya no hay una llave
  simétrica instalada en cada restaurante que permita firmar.
- **Canal de actualizaciones.** Central genera `publicado_ts` estrictamente
  monótono; Hub rechaza manifiestos vencidos, futuros, regresivos o con una
  versión mínima inválida y persiste la última marca aceptada. El token de GitHub
  solo se entrega por HTTPS a hosts de GitHub permitidos, incluidos los saltos de
  redirección. Las descargas usan directorio temporal único, validan SHA-256
  desde el archivo ya escrito y lo recalculan inmediatamente antes de lanzar el
  instalador.
- **Cobertura.** Las pruebas dejaron de usar cadenas que simulaban llaves:
  generan pares Ed25519 y comprueban firmas inválidas, reversión, frescura,
  mínimos, fuga de token, URL arbitraria y sustitución del instalador en disco.

### Decisión de despliegue obligatoria

Cambiar HMAC por Ed25519 invalida las licencias antiguas. Antes de actualizar un
Hub en un restaurante ya instalado hay que: **(1)** generar y resguardar los
pares, **(2)** compilar el Hub con las públicas, **(3)** reemitir y confirmar la
licencia nueva mientras el Hub anterior sigue activo y **solo entonces (4)**
actualizar el Hub. Hacerlo al revés puede dejar el local bloqueado sin soporte
remoto. La decisión y la secuencia están registradas en
[`ADR-25`](adr/ADR-25-firmas-ed25519-y-migracion.md).

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
