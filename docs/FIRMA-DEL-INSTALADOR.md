# Firma del instalador — trámite para MOTRAE

> Investigado en julio de 2026. Las reglas de este terreno cambiaron dos veces
> en dos años, así que conviene confirmar precios y requisitos con el proveedor
> antes de pagar.

## El problema que resuelve

Sin firma, Windows SmartScreen muestra *"Windows protegió su PC — editor
desconocido"* la primera vez que alguien ejecuta el instalador. Hay que hacer
clic en *Más información → Ejecutar de todas formas*.

Para vender software a restaurantes eso es un problema doble: da mala impresión
en la demostración, y enseña al cliente a saltarse avisos de seguridad — el
mismo hábito que evitamos en el resto del producto.

## La decisión: certificado OV, no EV

**Recomiendo OV (Organization Validation).** Es más barato y hoy hace lo mismo.

Hasta 2024 el certificado EV daba **reputación instantánea** en SmartScreen: el
instalador no mostraba ningún aviso desde el primer día. Ese era su valor y
justificaba el sobreprecio.

**Microsoft eliminó esa ventaja en marzo de 2024.** Hoy OV y EV construyen
reputación igual, por volumen de descargas. Pagar el premium de EV solo para
evitar el aviso ya no tiene sentido.

EV sigue valiendo la pena si algún día se firman **controladores de dispositivo**
o si un cliente corporativo lo exige por política de compras. No es el caso de
MotRest.

## Lo que hay que saber antes de cotizar

**El certificado ya no llega como archivo.** Desde junio de 2023 la llave
privada debe generarse y vivir en hardware certificado FIPS 140-2 nivel 2: un
token USB físico, un HSM en la nube, o uno propio. Se acabaron los `.pfx` que se
copiaban entre máquinas.

Esto tiene una consecuencia práctica: **firmar exige tener el token conectado**.
Si más adelante se automatiza la compilación en un servidor, hará falta un HSM
en la nube en lugar del token.

**La vigencia bajó a ~15 meses.** Desde marzo de 2026 el máximo es 460 días, no
39 meses. Hay que presupuestar la renovación como gasto anual.

**Azure Trusted Signing no es opción todavía.** Es la vía más barata —unos 10
USD al mes— pero solo está disponible para organizaciones de Estados Unidos,
Canadá, la Unión Europea y el Reino Unido. **México no está incluido** y no hay
fecha anunciada. Vale la pena revisarlo cada ciertos meses.

## Costo estimado

| Concepto | Rango | Nota |
|---|---|---|
| Certificado OV | 200–400 USD/año | Más barato contratando varios años |
| Token USB FIPS | 90–250 USD | Pago único, si no se usa HSM en la nube |
| **Primer año** | **~300–600 USD** | |

Proveedores habituales: Sectigo, DigiCert, SSL.com, y revendedores que suelen
salir bastante más baratos que el precio de lista.

## Documentos que MOTRAE necesita reunir

La autoridad certificadora tiene que comprobar cuatro cosas: que la empresa
existe legalmente, que opera, dónde está, y que quien pide el certificado
trabaja ahí.

**Existencia legal**
- Acta constitutiva de MOTRAE
- Constancia de situación fiscal del SAT (con el RFC)

**Domicilio y operación**
- Comprobante de domicilio fiscal reciente
- Teléfono de la empresa **listado en un directorio público verificable**. Este
  es el punto donde más solicitudes se atrasan: la autoridad llama a ese número
  y debe encontrarlo en una fuente independiente.

**Identidad de quien solicita**
- Identificación oficial de Gonzalo
- Prueba de que es representante legal (poder notarial o acta constitutiva)

### El atajo que ahorra semanas

Si el teléfono no aparece en un directorio público, o la verificación se
complica, existen dos caminos:

1. **Carta de opinión profesional** firmada por un contador o abogado. Un solo
   documento cubre existencia, domicilio, teléfono y relación laboral. Suele ser
   lo más rápido para una empresa joven.
2. **Registro D-U-N-S** de Dun & Bradstreet. Es gratuito, tarda unas semanas y
   las autoridades lo aceptan como fuente independiente. Sirve además para otros
   trámites internacionales.

Para MOTRAE recomiendo **la carta del contador**: es un trámite que ya se puede
pedir hoy, mientras que el D-U-N-S tarda.

## Pasos, en orden

1. Confirmar que el nombre legal de MOTRAE en el acta constitutiva es
   **idéntico** al que se pondrá en el certificado. Una diferencia de una
   palabra rechaza la solicitud.
2. Cotizar OV en dos o tres proveedores, incluyendo revendedores.
3. Pedir la carta de opinión profesional al contador de la empresa.
4. Comprar. Llega el token físico por mensajería.
5. Validación: la autoridad revisa documentos y llama por teléfono. **De dos
   días a dos semanas**, según qué tan limpia esté la documentación.
6. Generar la llave en el token siguiendo sus instrucciones.
7. Firmar el instalador (ver abajo).

## Cómo se firma, una vez que llegue

```powershell
signtool sign /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 /a `
  "MotRest_0.1.0_x64-setup.exe"
```

El **sellado de tiempo** (`/tr`) no es opcional: sin él, el instalador deja de
validar cuando el certificado caduce. Con él, sigue siendo válido para siempre
porque queda constancia de que se firmó cuando el certificado estaba vigente.

Tauri puede firmar automáticamente al compilar. Se configura en
`tauri.conf.json` con `windows.certificateThumbprint`, y así ningún artefacto
sale sin firmar por olvido.

### Hay DOS cosas que firmar, no una

Es el error fácil de cometer, porque el segundo no se ve:

| Qué | Quién lo firma | Por qué hace falta |
|---|---|---|
| `MotRest_x.y.z_x64-setup.exe` | Tauri, con `certificateThumbprint` | Es lo que el restaurante descarga y ejecuta una vez |
| `motrest-hub-x86_64-pc-windows-msvc.exe` | `empaquetar.mjs`, con `MOTREST_FIRMA_HUELLA` | **Es lo que se ejecuta cada mañana en la caja.** La firma del instalador no lo cubre: una vez instalado, ese archivo está en disco y sin firma propia nada lo distingue de otro que alguien deje en su lugar |

El Hub se firma **después** de meterle el código dentro (`inject`), nunca antes:
la inyección cambia los bytes e invalidaría cualquier firma previa. Por eso el
script quita primero la firma original de Node y pone la de MOTRAE al final.

Ya está cableado. El día que llegue el certificado:

```powershell
$env:MOTREST_FIRMA_HUELLA = "<la huella SHA-1 del certificado>"
corepack pnpm@9.15.0 --filter @motrest/hub empaquetar
```

Y la misma huella en `windows.certificateThumbprint` de los dos
`tauri.conf.json` (MotRest y MOTRAE Central). Sin la variable, el empaquetado
avisa en pantalla de que el Hub sale sin firmar y sigue: es lo que permite
probar sin certificado, y lo que no debe salir a un restaurante.

## Lo que la firma NO resuelve

**El aviso del certificado del Hub en las tablets** es otro problema distinto y
no se arregla con esto. Ese es el certificado TLS del servidor local, no la
firma del instalador. Su solución está en ADR-18: fijar el certificado en la
app.

**La reputación no es inmediata.** Incluso firmado, SmartScreen puede seguir
avisando hasta que el instalador acumule descargas. Se reduce con el tiempo y
firmando siempre con el mismo certificado. Renovar el certificado reinicia
parte de esa reputación, que es otra razón para contratar varios años de una vez.

---

## Fuentes

- [SmartScreen reputation for Windows app developers — Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [EV Certs do not grant immediate reputation anymore — ToDesktop](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore)
- [Artifact Signing FAQ — Microsoft Learn](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [Documentos requeridos para validación — CodeSigningStore](https://codesigningstore.com/documents-required-for-code-signing-certificate-validation)
- [Organization Authentication for Code Signing — The SSL Store](https://www.thesslstore.com/knowledgebase/code-signing-validation/organization-authentication-for-code-signing/)
- [Code Signing Certificates — Sectigo](https://www.sectigo.com/ssl-certificates-tls/code-signing)
