# Mudar los restaurantes de Fly a la nube

El orden de esta guía **no es negociable**. Cambiarlo deja a un restaurante fuera
de su propio sistema, y Rodizio está en producción: esto no es campo virgen.

> **Lee antes:** [ADR-28](adr/ADR-28-la-nube-en-supabase.md) explica por qué se
> mueve. Aquí solo está cómo, y en qué orden.

---

## Por qué el orden importa

Tres hechos, y de ellos sale todo lo demás:

1. **La dirección de la nube viaja firmada dentro de la licencia** de cada Hub
   instalado. Para mover un local hay que reemitirle la licencia; no hay una
   pantalla donde cambiarlo.
2. **El transporte viejo no se puede repuntar.** `EnlaceRelayWs` abre un socket y
   dice `{tipo:"hola"}`; Realtime habla Phoenix y autentica con un JWT. No es la
   misma conversación con otra URL. Por eso hace falta **una versión del Hub que
   hable los dos idiomas**, instalada, antes de tocar ninguna licencia.
3. **El webhook de Meta es atómico y de una sola dirección.** Hay una URL por
   app: al guardarla, todo el WhatsApp entrante cambia de sitio a la vez.

De ahí que Fly no se apague hasta el final. Y hay una simetría útil: **lo último
que hace el relay es entregarle a cada restaurante su boleto de salida**.

---

## Lo que NO hay que migrar

**Los tokens de WhatsApp de los locales.** Suena a que hay que sacarlos del
padrón cifrado de Fly y meterlos en la nube, y no hace falta: cada Hub
**republica sus credenciales en cada conexión**, a propósito, para que un padrón
perdido se recupere solo. Al conectar con la nube las manda otra vez y la ficha
se completa sola.

Del padrón viejo solo se necesita **la lista de `sucursal_id` y nombre**:

```powershell
fly ssh console --app motrest-relay
padron lista
```

Las credenciales sí son nuevas — no se pueden recuperar, el padrón solo guarda su
huella — y viajan en la licencia reemitida, que es donde tienen que ir.

---

## 0 · Antes de empezar

- [ ] La nube está desplegada y probada ([`DESPLEGAR-LA-NUBE.md`](DESPLEGAR-LA-NUBE.md))
- [ ] **El proyecto está en Pro.** Free no trae respaldos ni PITR
- [ ] La llave del padrón está guardada donde las llaves de firma
- [ ] Tienes a mano `padron lista` del relay

## 1 · El Hub que habla los dos idiomas

Se empaqueta con la llave publicable dentro, junto a las públicas de siempre:

```powershell
$env:MOTREST_LICENCIA_PUBLICA="…"
$env:MOTREST_ACTUALIZACIONES_PUBLICA="…"
$env:MOTREST_NUBE_PUBLICABLE="sb_publishable_…"
corepack pnpm@9.15.0 --filter @motrest/hub empaquetar
```

Se publica **por el carril de hoy** (GitHub Releases), con la lista de
comprobación de siempre. El renglón que más caro sale de saltarse sigue siendo el
mismo: **instalarlo sobre una instalación anterior**.

Esta versión no mueve a nadie. Solo enseña el idioma nuevo.

## 2 · Esperar adopción, mirando los pulsos

```powershell
# En Central, o contra el relay:
curl.exe -H "authorization: Bearer $env:MOTREST_RELAY_CLAVE_ADMIN" https://relay.motrae.mx/pulsos
```

**Nadie se mueve hasta que todos la tengan.** Un local que se quede en la versión
anterior y reciba una licencia apuntando a `https://…` no sabrá qué hacer con
ella: su `direccionUsable()` exige `wss://` y rechazará la dirección él solo. El
síntoma sería un restaurante sin pulso y sin renovaciones, en silencio.

Para esto se inventaron los pulsos ([ADR-26](adr/ADR-26-actualizacion-remota.md)
§6). Es el momento en que se cobran.

## 3 · Dar de alta a cada local en la nube

Uno por uno, con el mismo `sucursal_id` que ya tiene:

```powershell
corepack pnpm@9.15.0 --filter @motrest/central alta-nube -- --sucursal suc-a1b2c3d4 --nombre "Rodizio"
```

Guarda la credencial que devuelve: la necesitas en el paso siguiente y **no se
vuelve a mostrar**.

## 4 · Reemitir la licencia, y que la lleve el relay

La licencia nueva lleva la dirección de la nube y la credencial del paso 3. Se
deposita en el relay de Fly, que se la entrega al Hub cuando esté conectado — o
la guarda hasta que encienda por la mañana.

```powershell
corepack pnpm@9.15.0 --filter @motrest/central licencia -- --sucursal suc-a1b2c3d4 --nombre "Rodizio" ...
curl.exe -X POST -H "authorization: Bearer $env:MOTREST_RELAY_CLAVE_ADMIN" -H "content-type: application/json" --data-binary "@licencia.json" https://relay.motrae.mx/licencia
```

El Hub la verifica contra su pública compilada —Fly no puede falsificarla— y al
instalarla se reconecta contra la nube.

**Empieza por un local y míralo un fin de semana entero** antes de seguir con los
demás. Es el mismo criterio del anillo: nunca a toda la flota a la vez.

## 5 · Confirmar que llegaron

```sql
select nombre, version_instalada, ultimo_pulso_ts from public.adopcion order by ultimo_pulso_ts desc nulls last;
```

**Un local que no aparece con pulso reciente, no ha migrado.** No sigas al paso 6
hasta que estén todos: después de cambiar el webhook, un local que siga hablando
con Fly deja de recibir los mensajes de sus comensales.

## 6 · Mover el webhook de Meta

Ahora sí, y de una vez ([`DESPLEGAR-LA-NUBE.md`](DESPLEGAR-LA-NUBE.md) §6).

Ensáyalo antes contra un número de prueba: manda un mensaje al WhatsApp de un
local y comprueba que aparece la fila.

```sql
select sucursal_id, contacto, left(texto, 40), ts, entregado_ts
  from public.mensajes_entrantes order by ts desc limit 5;
```

`entregado_ts` con valor significa que su Hub ya se lo llevó. En blanco durante
más de unos segundos, con el local encendido, es que Realtime no está llegando.

## 7 · Dos semanas de silencio

Fly se queda encendido, sin tráfico, por si aparece un rezagado. Cuesta 3.50 USD
y compra la posibilidad de volver atrás; apagarlo antes no ahorra nada que valga
ese riesgo.

Mira sus registros de vez en cuando: **si algún Hub sigue conectándose ahí, ese
local no migró** y hay que averiguar por qué antes de seguir.

```powershell
fly logs --app motrest-relay
```

## 8 · Apagar

**El padrón, antes de destruir el volumen.** Después ya no hay de dónde sacarlo:

```powershell
fly ssh sftp get /datos/restaurantes.json ./respaldo-padron-final.json --app motrest-relay
fly ssh sftp get /datos/pulsos.json ./respaldo-pulsos-final.json --app motrest-relay
```

Guárdalos con la llave `MOTREST_RELAY_LLAVE_PADRON` **en sitios distintos**, como
siempre. Y entonces:

```powershell
fly apps destroy motrest-relay
```

Y en el repositorio, en un commit aparte y con su propio motivo:

- `apps/relay/` completo
- `docs/DESPLEGAR-EL-RELAY.md`
- `EnlaceRelayWs` y `direccionUsable()` en el Hub — **solo cuando ninguna licencia
  viva apunte a `wss://`**, no antes

---

## Si hay que volver atrás

Mientras Fly siga encendido y el webhook no se haya movido, volver es reemitir la
licencia con la dirección vieja. Después del paso 6 ya no: habría que devolver el
webhook a Fly primero, y en ese hueco se pierden los mensajes entrantes.

**Ese es el punto de no retorno**, y por eso el paso 5 existe.
