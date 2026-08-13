# `legal/` — El cuerpo legal de MotRest

Documentación legal de **MotRest**, producto de **MOTRAE**, para el mercado **mexicano**.

**Estos archivos `.md` son la fuente de verdad.** La página pública, las pantallas de la aplicación y
los `.docx` de `entregables/` se generan a partir de aquí. Si hay diferencia entre un `.docx` y su
`.md`, manda el `.md`: es el que tiene historial de cambios en Git, y ese historial es la prueba de
qué versión aceptó cada cliente.

---

## Marco normativo

| Norma | Qué gobierna |
|---|---|
| **LFPDPPP** (DOF 20-mar-2025, vigente desde el 21-mar-2025) | Todo el tratamiento de datos personales |
| **LFPC** (arts. 7, 7 BIS, 10, 18, 18 BIS, 85, 86) | Precios, propinas, publicidad, cláusulas abusivas |
| **CFF art. 30** | Conservación fiscal, 5 años |
| **NOM-151-SCFI-2016** | Integridad de los documentos conservados |
| **Ley Federal del Derecho de Autor** | El software como obra; la licencia de uso |
| **Reglas de Google, Yahoo y Meta** | Entrega de correo y mensajería |

**Autoridad:** desde 2025 es la **Secretaría Anticorrupción y Buen Gobierno**, no el INAI.
**Reglamento:** el de la nueva ley sigue pendiente; el de 2011 aplica supletoriamente en lo que no la
contradiga.

---

## Los documentos

### Base

| | Documento | Uso |
|---|---|---|
| **00** | [Mapa de datos](00-mapa-de-datos.md) | **Interno.** Inventario, flujos, responsabilidades y brechas. Todo lo demás deriva de aquí. |

### A · Con el restaurante (se firman)

| | Documento | Dónde vive |
|---|---|---|
| **A1** | [EULA](A1-eula.md) | Pantalla del instalador + `.docx` |
| **A2** | [Contrato de Suscripción y Servicio](A2-contrato-suscripcion.md) | `.docx` firmable |
| **A3** | [Convenio de Encargado del Tratamiento](A3-convenio-encargado.md) | Anexo firmado del A2 |
| **A4** | [Anexo Fiscal — CSD y timbrado](A4-anexo-fiscal.md) | Anexo firmado del A2 |

### B · Público de MOTRAE

| | Documento | URL |
|---|---|---|
| **B1** | [Aviso de Privacidad de MOTRAE](B1-aviso-privacidad-motrae.md) | `motrest.mx/privacidad` |
| **B2** | [Términos del sitio](B2-terminos-sitio.md) | `motrest.mx/terminos` |
| **B3** | [Política de Cookies](B3-cookies.md) | `motrest.mx/cookies` |

### C · Plantillas para el restaurante

| | Documento | Dónde va |
|---|---|---|
| **C1** | [Aviso de Privacidad del restaurante](C1-aviso-privacidad-restaurante.md) | `motrest.mx/p/<local>` · portal · ticket |
| **C2** | [Aviso de Privacidad laboral](C2-aviso-privacidad-laboral.md) | Se entrega al personal, con acuse |
| **C3** | [Términos del portal del comensal](C3-terminos-portal.md) | Pie del portal |
| **C4** | [Comunicaciones comerciales](C4-comunicaciones-comerciales.md) | Interno + obligaciones técnicas |

### D · Internos de MOTRAE

| | Documento |
|---|---|
| **D1** | [Política de Seguridad](D1-politica-seguridad.md) |
| **D2** | [Procedimiento de vulneraciones](D2-vulneraciones.md) |
| **D3** | [Procedimiento ARCO](D3-procedimiento-arco.md) |
| **D4** | [Política de retención](D4-retencion.md) |
| — | [Acceso de soporte de MOTRAE](../docs/SOPORTE-Y-ACCESO-REMOTO.md) — vive en `docs/` porque el código lo cita desde ahí |

---

## Lo que falta para poder usarlos

### 🔴 Bloqueantes antes de publicar o firmar

- [ ] **Registrar `motrest.mx`** y apuntarlo. El código ya depende de él
      (`DOMINIO_MOTRAE = "avisos.motrest.mx"`), y ahí viven el aviso integral, los avisos por local y
      la ruta de baja. `www.motrae.com` no sirve para esto.
- [ ] **Datos fiscales reales:** sustituir `[NOMBRE COMPLETO]`, `[RFC]` y
      `[DOMICILIO FISCAL COMPLETO]` en A1, A2, A3, A4, B1 y B2.
- [ ] **Crear el buzón `privacidad@motrest.mx`** y asignar quién lo revisa cada día hábil.
- [ ] **Decidir el campo `notas`/alergias** — ver [00 §2.1](00-mapa-de-datos.md). Recomendación:
      reetiquetar como preferencias y prohibir salud en la interfaz.
- [ ] **Decidir el cifrado en reposo** — ver [A3 Anexo II §4.1](A3-convenio-encargado.md). O se
      cifra, o se firma con la limitación declarada y su fecha.
- [ ] **Confirmar los tiempos de soporte** de [A2 §6](A2-contrato-suscripcion.md). Están marcados
      como propuesta.
- [ ] **Revisión de un abogado mexicano** sobre A1–A4 antes de la primera firma.

### 🔴 Código que estos documentos obligan a escribir

| Qué | Dónde | Lo obliga |
|---|---|---|
| **Ruta pública de baja de correo** — en el relay o en `motrest.mx`, **nunca en el Hub**, que sólo es alcanzable desde la red del local | Relay / sitio | C4 §11 |
| **Cabeceras `List-Unsubscribe` y `List-Unsubscribe-Post`** (RFC 8058) | `apps/hub/src/smtp.ts` y `correo.ts` | C4 §11 |
| **Alimentar `datos.baja`** — hoy sólo existe en los tests, y el pie de baja se omite en silencio | `packages/dominio/src/clientes/correo.ts` | C4 §12 |
| **Lista de exclusión** persistente, que sobreviva a la supresión de la ficha | Dominio | C4 §3 · D4 §2 |
| **Consentimiento otorgado como hecho probatorio** (fecha, canal, texto aceptado) | Dominio | C4 §2 |
| **Supresión de datos personales** sobre el registro append-only, con barrido de respaldos | Dominio + Hub | D3 §5 |
| **Purga por retención** de reservas, opiniones y mensajes | Hub | D4 §5 |
| **Aviso corto en el ticket**, una línea junto al QR | `packages/impresion/src/plantillas.ts` | C1 modalidad 3 |
| **EULA en el instalador** + evento `eula_aceptado` | Instalador NSIS + dominio | A1 |
| **Recordatorio de consulta al REPEP** en la pantalla de campañas | POS | C4 §4 |
| **SPF, DKIM y DMARC** en `motrest.mx` | Infraestructura | C4 §11 |

> **Regla mientras esto no exista:** MOTRAE **no habilita campañas de marketing por correo** a
> ningún cliente. Lo transaccional puede seguir operando; no lleva baja y no la necesita.

### 🟠 Verificación pendiente

- [ ] **La propina.** PROFECO prohíbe incluirla en la cuenta sin consentimiento y fijar porcentajes
      impuestos (LFPC arts. 7, 7 BIS y 10). Revisar el flujo de pre-cuenta y confirmar que la
      sugerencia es visiblemente opcional y no se suma sola.
- [ ] **Verificación de empresa en Meta** con `motrest.mx/privacidad` publicado. Es el único examen
      externo real: o pasa o no pasa.

---

## Cómo se mantiene esto

1. **Una función nueva que toque datos personales pasa primero por [`00-mapa-de-datos.md`](00-mapa-de-datos.md).**
   Si añade un campo a un evento o abre una salida de red, se actualiza el inventario antes de
   escribir el código.
2. **Cada documento lleva versión y fecha.** Al cambiar uno que el cliente haya aceptado, se sube la
   versión y se le avisa con la anticipación que marque el propio documento.
3. **Nada se promete aquí que el software no haga.** Las tablas de «estado de implantación» de C4,
   D3 y D4 existen justamente para eso, y se actualizan al implantar cada punto.

**El principio que gobierna toda esta carpeta:** un documento que promete algo que el software no
hace es peor que no tenerlo. No es protección — es prueba escrita del incumplimiento.
