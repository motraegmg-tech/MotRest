# Desplegar la nube de MotRest

Se hace **una vez**; después, dar de alta un restaurante son dos minutos y **ya
no hay que entrar por SSH a ninguna máquina**.

> Hubo antes un servidor propio en Fly.io con su propia guía de despliegue. Se
> retiró junto con el servicio: **nunca llegó a existir** —el dominio no se
> registró y la aplicación no tenía máquinas— y mientras tanto cada Hub
> reintentaba contra él en silencio. El registro de aquella decisión sigue en
> [ADR-27](adr/ADR-27-donde-vive-el-relay.md), marcado como superado.

> **Lo que hay en la nube.** El padrón, el pulso de cada local, las renovaciones
> sin recoger y el catálogo de versiones. Ni comandas, ni ventas, ni clientes:
> eso vive en el restaurante y ahí se queda. Si esto se cae, **el restaurante
> sigue vendiendo**.

Proyecto: `motrest-nube` (`ixttslqbbwqfcqjmttyg`), región `us-east-1`.

---

## Los comandos son de PowerShell

Dos avisos que ahorran media hora, los mismos de siempre:

- **Usa `curl.exe`, con la extensión.** A secas es un alias de
  `Invoke-WebRequest`, que no entiende `-H`.
- **Comillas simples para los secretos.** Entre comillas dobles, PowerShell se
  come un `$` que haya dentro y el secreto llega incompleto.

---

## 1 · La herramienta y la sesión

```powershell
corepack pnpm@9.15.0 dlx supabase login
corepack pnpm@9.15.0 dlx supabase link --project-ref ixttslqbbwqfcqjmttyg
```

`login` abre el navegador. `link` deja el proyecto asociado a esta carpeta, y a
partir de ahí los comandos ya no necesitan `--project-ref`.

## 2 · El esquema

```powershell
corepack pnpm@9.15.0 dlx supabase db push
```

Aplica [`supabase/migrations/`](../supabase/migrations/) en orden. **Nunca se
edita una migración ya aplicada**: se escribe otra encima. Lo que está en el
repositorio es lo que está en la base de datos, y esa correspondencia es lo único
que hace revisable un cambio de esquema.

## 3 · La llave del padrón

⚠ **Guárdala antes de seguir.** Con ella se cifran los tokens de WhatsApp de
todos los restaurantes; sin ella, ese campo no se puede leer y hay que volver a
conectar el número de cada local uno por uno. Supabase la guarda y **no te la
vuelve a enseñar**.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Va donde ya están las llaves de firma de MOTRAE, con el mismo cuidado. Esto no es
higiene: es la diferencia entre restaurar un respaldo y llamar a cincuenta
restaurantes.


## 4 · Los secretos

Tres, y **sin ellos el webhook rechaza todo con 503** — a propósito: uno sin
`APP_SECRET` aceptaría cualquier cosa que le llegue, y eso es peor que no tener
webhook.

```powershell
corepack pnpm@9.15.0 dlx supabase secrets set MOTREST_LLAVE_PADRON='la-del-paso-3'
corepack pnpm@9.15.0 dlx supabase secrets set MOTREST_META_VERIFY_TOKEN='el-que-te-inventes'
corepack pnpm@9.15.0 dlx supabase secrets set MOTREST_META_APP_SECRET='el-de-Meta'
```

El de verificación te lo inventas tú y lo tecleas después en el panel de Meta:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Si todavía no tienes el App Secret de Meta, pon cualquier cosa para poder seguir
y cámbialo después con el mismo comando. **Hasta que sea el bueno, todos los
webhooks se descartan** — que es exactamente lo que debe hacer.

Comprobar (enseña los nombres, nunca los valores):

```powershell
corepack pnpm@9.15.0 dlx supabase secrets list
```

## 5 · Las funciones

```powershell
corepack pnpm@9.15.0 dlx supabase functions deploy webhook-whatsapp --no-verify-jwt
corepack pnpm@9.15.0 dlx supabase functions deploy enviar-whatsapp
corepack pnpm@9.15.0 dlx supabase functions deploy publicar-credenciales
```

> **`--no-verify-jwt` solo en la primera**, y hay que entender por qué: Meta no
> tiene cómo llevar un JWT nuestro, así que esa función se publica abierta y lo
> que la protege es la firma HMAC del cuerpo. Las otras dos **exigen** el JWT del
> local — ponerles `--no-verify-jwt` dejaría que cualquiera pidiera mandar
> WhatsApp en nombre de un restaurante.

Que están vivas:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" "https://ixttslqbbwqfcqjmttyg.supabase.co/functions/v1/webhook-whatsapp?hub.mode=subscribe&hub.verify_token=NO-ES&hub.challenge=1"
```

- **403** — funcionando: el token no coincide y no se le confirma a nadie que la
  URL exista.
- **503** — falta un secreto del paso 4.

## 6 · El webhook en Meta

| Campo | Valor |
|---|---|
| URL de devolución de llamada | `https://ixttslqbbwqfcqjmttyg.supabase.co/functions/v1/webhook-whatsapp` |
| Token de verificación | el `MOTREST_META_VERIFY_TOKEN` del paso 4 |
| Campo suscrito | **`messages`** |

> **Este paso es de una sola dirección.** Hay una URL de webhook por app: en el
> instante en que se guarda, todo el WhatsApp entrante viene aquí. Ensáyalo
> antes contra el número de pruebas que Meta regala — un webhook mal puesto no
> avisa, simplemente deja de llegar lo que el comensal escribe.

## 7 · Dar de alta un restaurante

El `sucursal_id` **no te lo inventas**: lo genera el Hub al instalarse y lo
escribe en `<datos>/sucursal.txt`. Cópialo de ahí.

```powershell
$env:MOTRAE_SUPABASE_URL = "https://ixttslqbbwqfcqjmttyg.supabase.co"
$env:MOTRAE_SUPABASE_SERVICE_ROLE = "..."
corepack pnpm@9.15.0 --filter @motrest/central alta-nube -- --sucursal suc-a1b2c3d4 --nombre "Rodizio"
```

Devuelve una credencial que **se enseña una sola vez**. No se pega a mano en la
caja: va dentro de la licencia firmada.

> La llave de servicio entra por variable de entorno y **nunca como argumento**:
> los argumentos quedan en el historial del shell y en la lista de procesos, y
> esa llave se salta todas las políticas RLS.

## 8 · El respaldo

En Free **no hay respaldos ni PITR**. Es la razón concreta por la que hay que
subir a Pro antes de que un restaurante dependa de esto — no la única, pero sí la
que se nota el día malo.

Mientras tanto, lo que no se puede regenerar son dos cosas y se guardan por
separado:

1. **La llave del padrón** (paso 3), que ya está donde las llaves de firma.
2. **El padrón**, que se baja cuando cambia — o sea, tras cada alta o baja:

```powershell
corepack pnpm@9.15.0 dlx supabase db dump --data-only -f respaldo-padron.sql
```

Los tokens salen ahí **cifrados**. Guárdalo en un sitio distinto de la llave:
juntos son el padrón en claro. Esa incomodidad es el diseño.

---

## Si algo no sale

| Síntoma | Casi siempre es |
|---|---|
| El webhook responde 503 | Falta un secreto del paso 4 |
| Meta responde 403 al verificar | El token del panel no es el del secreto |
| `curl` se queja de `-H` | Es el alias de PowerShell. Escribe `curl.exe` |
| El Hub dice «la nube rechazó la credencial» | El alta se hizo con otro `sucursal_id`, o la licencia lleva una credencial vieja |
| El Hub dice «tiene que ser https://» | Se configuró `http://`. Lo rechaza él solo, antes de abrir nada |
| «se publicó MotRest X con una firma que no es de MOTRAE» | El manifiesto se guardó reconstruido en vez de tal cual. Mira ADR-28 §Decisión 2 |
| Un local no ve la versión nueva | Su fila en `asignaciones` lo tiene fijado a otra, o la versión está `retirada_ts` |
| El Hub conecta pero no llega nada | Realtime no está habilitado en esa tabla. Lo hace la migración `20260828000500_realtime.sql` |

---

## Documentos relacionados

- [ADR-28 · La nube en Supabase, y el relay se apaga](adr/ADR-28-la-nube-en-supabase.md)
- [El esquema, tabla por tabla](../supabase/README.md)
- [ADR-27 · Dónde vive el relay](adr/ADR-27-donde-vive-el-relay.md) — la decisión que esto superó
