# MotRest para Windows — la caja del local

Un solo instalador deja la caja lista: punto de venta, Hub del local y arranque
automático. Es el criterio de aceptación de la etapa 12 — *"un instalador que un
tercero instala solo"*.

## Por qué una app y no solo el navegador

No es por rendimiento ni por estética. Los navegadores solo exponen
`crypto.subtle` —el motor criptográfico— en contextos seguros, y una terminal
abierta por la IP del local en `http://` no lo tiene. Sin él no se pueden
verificar contraseñas, ni cifrar el canal con el Hub, ni sellar el corte.

Una app Tauri corre en un origen que el sistema considera seguro por definición.
El mismo POS, el mismo código, sin advertencias que saltarse.

## Construir el instalador

```bash
corepack pnpm@9.15.0 --filter pos-ui build          # el POS que va dentro
corepack pnpm@9.15.0 --filter @motrest/hub empaquetar   # el Hub como .exe
corepack pnpm@9.15.0 --filter @motrest/escritorio build
```

Sale en `src-tauri/target/release/bundle/nsis/`.

### Comprobar QUÉ entró en el instalador

La lista autoritativa es el script que genera Tauri, no el árbol de compilación:

```bash
grep -oE 'oname=pos.assets.index-[A-Za-z0-9_-]+\.js' \
  $CARGO_TARGET_DIR/release/nsis/x64/installer.nsi
```

Tiene que salir **exactamente uno**, y ser el mismo que hay en `pos-ui/dist`.

> Puede quedar un `release/pos` de compilaciones antiguas con bundles viejos
> dentro. **No entra en el instalador**: Tauri 2 lee directo de `pos-ui/dist`.
> Mirar esa carpeta para juzgar el paquete lleva a conclusiones falsas — pasó, y
> costó una recompilación de más.

### En Windows, compila fuera de `Documents`

```bash
CARGO_TARGET_DIR=C:\motrest-build
```

Defender en tiempo real bloquea los archivos objeto mientras Rust los escribe y
la compilación falla con `os error 32`. Compilar fuera de las carpetas que
escanea con más agresividad lo resuelve **sin tocar la configuración de
seguridad del equipo**, que es lo que no queremos pedirle a nadie.

## Qué lleva dentro

| Pieza | Qué es |
|---|---|
| `motrest.exe` | La app: ventana, webview y arranque del Hub (~5 MB) |
| `motrest-hub-*.exe` | El Hub completo con Node incrustado (~91 MB) |
| `pos/` | El POS compilado |

El Hub va como *sidecar*: la app lo levanta al abrir y lo cierra al salir.
Dejarlo vivo tras cerrar la caja mantendría el puerto ocupado y el siguiente
arranque fallaría sin explicación.

## Firma del instalador

**Pendiente del trámite comercial.** Sin firma, Windows SmartScreen muestra
"editor desconocido" la primera vez.

El trámite completo —qué certificado conviene, qué documentos necesita MOTRAE y
cuánto cuesta— está en [`docs/FIRMA-DEL-INSTALADOR.md`](../../docs/FIRMA-DEL-INSTALADOR.md).

Cuando llegue el certificado, se firma automáticamente al compilar añadiendo a
`tauri.conf.json`:

```json
"windows": {
  "certificateThumbprint": "LA-HUELLA-DEL-CERTIFICADO",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.sectigo.com"
}
```

El `timestampUrl` no es opcional: sin sellado de tiempo, el instalador deja de
validar cuando el certificado caduca. Con él, sigue siendo válido para siempre.

## Pendiente: fijar el certificado del Hub

La app de la caja no sufre el aviso del certificado —habla con el Hub por
`localhost`—. Una tablet sí, porque habla por la red.

El camino correcto es **fijar el certificado** (pinning): el QR de
emparejamiento ya puede llevar la huella que el Hub publica en `/salud`, y la
app aceptar exactamente ese certificado y ningún otro. Sin advertencia, y más
seguro que confiar en una autoridad pública. Exige mover el canal al lado
nativo; está razonado en ADR-18.
