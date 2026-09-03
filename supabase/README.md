# La nube de MotRest

Lo que sustituye al relay de Fly.io. Aquí solo vive **el esquema**: qué tablas
hay, quién puede leer cada fila y qué se recorta antes de guardarse.

> **Ni una comanda, ni una venta, ni un cliente.** Eso vive en el Hub del
> restaurante y ahí se queda (TRD R3). Lo que hay en la nube es el padrón, el
> parte de vida de cada local, las renovaciones sin recoger y el catálogo de
> versiones. Si esta base de datos se cae, **el restaurante sigue vendiendo**.

Proyecto: `motrest-nube` (`ixttslqbbwqfcqjmttyg`), región `us-east-1`.

---

## Las tablas, en una línea cada una

| Tabla | Qué guarda | A quién sustituye |
|---|---|---|
| `sucursales` | El padrón: quién es cliente | `/datos/restaurantes.json` del volumen de Fly |
| `pulsos` | El último parte de cada local | `/datos/pulsos.json` |
| `mensajes_entrantes` | WhatsApp que espera a que su local lo recoja | `YaVistos`, que era un Map **en memoria** |
| `licencias_pendientes` | Renovaciones firmadas sin entregar | `/datos/licencias.json` |
| `versiones` | Cada versión publicada, con su manifiesto firmado | El `motrest.json` de GitHub Releases |
| `asignaciones` | A qué versión va cada restaurante | El anillo por porcentaje de ADR-26 §5 |
| `adopcion` (vista) | Qué le ofrecí a cada quien y qué corre de verdad | Un cruce a mano en Central |

## Las tres reglas que sostienen todo esto

1. **La sucursal sale del JWT, nunca del cuerpo de la petición.**
   `privado.sucursal_actual()` la lee de `app_metadata`, que firma Supabase Auth
   y el Hub no puede escribir. Es la misma propiedad que el relay conseguía
   derivando la identidad de la credencial del saludo: *un local no puede decir
   que es otro*.

2. **Las funciones auxiliares viven en `privado`, no en `public`.**
   PostgREST publica `public` entero como RPC. Con `version_ofrecida` ahí,
   cualquiera podía preguntar por la sucursal del vecino pasándola como
   argumento. Y no basta con revocar `EXECUTE`: las políticas RLS se evalúan con
   los privilegios de quien consulta, así que sin permiso la consulta revienta en
   vez de devolver cero filas. Por eso un esquema aparte — el mismo patrón que
   usa Supabase con `auth.uid()`.

3. **La firma Ed25519 sigue siendo la autoridad.** Central firma con su privada,
   que no sale de ahí; el Hub verifica contra su pública compilada antes de
   descargar un byte. **Supabase no es parte de confianza**, igual que GitHub
   nunca lo fue: puede dejar de servir una versión, no puede fabricar ninguna.
   Que la columna `firma` esté en una tabla no la vuelve verdadera.

## Trabajar en local

```powershell
corepack pnpm@9.15.0 dlx supabase link --project-ref ixttslqbbwqfcqjmttyg
corepack pnpm@9.15.0 dlx supabase db reset     # esquema + seed.sql
```

`seed.sql` **no se carga nunca en producción**, y sus nombres son falsos a
propósito ("El Vecino", "La de Enfrente"): una semilla de demostración ya viajó
una vez a un Hub y su personal de mentira acabó pareciendo personal de verdad.

## Comprobar que el aislamiento es real

No se da por bueno porque la política esté escrita. Se comprueba haciéndose pasar
por un local:

```sql
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","app_metadata":{"sucursal_id":"suc-a1b2c3d4"}}';

select count(*) from public.sucursales;   -- 1, la suya
select count(*) from public.versiones;    -- 1, la que le toca. No el catálogo
insert into public.pulsos (sucursal_id, version) values ('suc-e5f6a7b8', '9.9.9');
                                          -- rebota: no puede reportar por otro
```

Y que el pulso se sanea de verdad: manda un `ts` de 2019 y un `token` colado
dentro de `dispositivos`. El servidor pisa la hora y el token no sobrevive — el
inventario se reconstruye campo a campo en vez de copiarse, porque un token de
emparejamiento ahí dentro es la credencial con la que cualquiera sincroniza
contra el Hub de ese local.

## El ensayo contra la nube de verdad

Lo anterior comprueba el esquema. Esto comprueba **que la nube hace lo que
creemos**, usando la clase `EnlaceSupabase` tal cual la usa el Hub: inicia
sesión de verdad, abre Realtime de verdad, y mira qué llega y qué no.

```powershell
# 1 · montar los dos locales de ensayo (supabase/ensayo-nube.sql)
# 2 · correrlo:
$env:MOTREST_NUBE_URL="https://ixttslqbbwqfcqjmttyg.supabase.co"
$env:MOTREST_NUBE_PUBLICABLE="sb_publishable_…"
$env:MOTREST_ENSAYO_CREDENCIAL="credencial-de-ensayo-01-no-sirve-fuera"
$env:MOTREST_ENSAYO_CREDENCIAL_VECINA="credencial-de-ensayo-02-no-sirve-fuera"
corepack pnpm@9.15.0 --filter @motrest/hub ensayo:nube
# 3 · desmontar (el final de ensayo-nube.sql)
```

Los pasos de Realtime necesitan que alguien inserte la fila desde fuera —Meta y
Central, en la vida real—; el guion imprime el SQL y espera. Si nadie lo hace,
esos renglones salen como **PENDIENTE** y no como **ok**: no haber comprobado
algo no es lo mismo que haberlo comprobado bien.

**Ya se ganó el sueldo.** Destapó que las renovaciones a partir de la segunda no
llegaban: `licencias_pendientes` tiene la sucursal como clave primaria, así que
la primera es un `INSERT` y todas las demás son `UPDATE` — y la suscripción solo
escuchaba `INSERT`. El local habría recibido su primera renovación al instante y
las siguientes solo al reconectar el Hub, que en un local encendido son semanas.
Ninguna prueba con dobles lo habría visto.

## Documentos relacionados

- [ADR-26 · La actualización remota que de verdad actualiza](../docs/adr/ADR-26-actualizacion-remota.md)
- [ADR-27 · Dónde vive el relay](../docs/adr/ADR-27-donde-vive-el-relay.md) — lo que este cambio revisa
