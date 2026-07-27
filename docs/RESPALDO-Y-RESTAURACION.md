# Respaldo y restauración del registro del local

`hub.sqlite` guarda **toda** la operación: cada venta, cada corte de caja y cada
CFDI emitido. El SAT exige conservar los comprobantes **cinco años**, así que
perder ese archivo no es perder un historial: es perder registros fiscales.

Este documento explica cómo se respalda (automático) y cómo se restaura (a
mano, y a propósito).

---

## Lo que hace el Hub solo

Al encender y una vez al día:

1. Crea una copia consistente con `VACUUM INTO`.
2. La **verifica**: la vuelve a abrir, le corre `integrity_check` y comprueba
   que traiga la tabla de eventos. Si no pasa, la borra y avisa — una copia
   corrupta que se cree buena es peor que no tener ninguna.
3. Conserva las **últimas 7** y borra las más viejas, para no llenar el disco.

Las copias viven en `%LOCALAPPDATA%\MotRest\datos\respaldos\`, con nombre
ordenable por fecha: `hub-2026-07-27T18-44-19.sqlite`.

El estado se ve en **Administración → Hub del local**, y en
`http://localhost:8788/salud` desde la propia caja.

---

## ⚠️ Nunca copies `hub.sqlite` a mano

Parece un respaldo y **no lo es**.

La base opera en modo WAL: lo recién confirmado vive en `hub.sqlite-wal` y
todavía no bajó al archivo principal. En la caja de Rodizio, ahora mismo:

| Archivo | Tamaño |
|---|---|
| `hub.sqlite` | 4 KB |
| `hub.sqlite-wal` | 1.8 MB |

Copiar solo `hub.sqlite` se lleva **4 KB sin una sola venta**. Se comprobó: al
abrir esa copia, SQLite responde `no such table: eventos`.

Si necesitas una copia manual, usa la que el Hub ya dejó en `respaldos\`, o
copia **los tres archivos juntos** (`hub.sqlite`, `-wal` y `-shm`) con el Hub
apagado.

---

## Llevarse los respaldos fuera del equipo

Una copia en el mismo disco protege de un borrado o una corrupción, **no de que
el disco se dañe**. Para eso, apunta los respaldos a una unidad externa o a una
carpeta sincronizada, con la variable de entorno:

```
MOTREST_RESPALDOS=D:\RespaldosMotRest
```

Recomendación para el local: una USB dedicada que se quede puesta, y una vez a
la semana llevarse la copia más reciente fuera del restaurante.

---

## Restaurar

**Restaurar sobrescribe la operación actual.** No hay botón para esto a
propósito: es una operación rara y destructiva, y un clic mal dado borraría la
venta del día. Se hace a mano y con calma.

1. **Cierra MotRest** en la caja. Comprueba en el Administrador de tareas que no
   quede `motrest.exe` ni `motrest-hub.exe`.

2. **Guarda lo que hay**, aunque creas que está dañado. Renombra la carpeta
   `datos` a `datos-roto-AAAA-MM-DD` en vez de borrarla: si la restauración
   sale mal, es lo único que queda.

3. **Crea una carpeta `datos` nueva** y copia dentro el respaldo elegido,
   renombrándolo a `hub.sqlite`:

   ```
   copy "respaldos\hub-2026-07-27T18-44-19.sqlite" "datos\hub.sqlite"
   ```

   No copies ningún `-wal` ni `-shm` viejo: el respaldo es autocontenido y un
   `-wal` de otra base lo corrompería.

4. **Recupera lo que no está en la base**, de la carpeta que guardaste en el
   paso 2:
   - `csd\` — el Certificado de Sello Digital y su contraseña.
   - `tls\` — el certificado del Hub. Si no lo recuperas, las terminales
     avisarán de un certificado nuevo y hay que volver a emparejarlas.
   - `fiscal.sqlite` — la cola de timbrado.

5. **Abre MotRest** y comprueba en `/salud` que la secuencia (`seq`) sea la que
   esperabas.

6. **Avisa a las terminales.** Si la secuencia del Hub quedó por debajo de la
   que ya tenían, ellas lo detectan y reenvían lo suyo automáticamente
   (`reabrirOutbox`). Aun así, revisa que las mesas abiertas se vean bien antes
   de seguir vendiendo.

---

## Lo que se pierde al restaurar

Todo lo ocurrido **entre el respaldo y la falla**. Con respaldo diario, eso es
hasta un día de operación. Si eso es demasiado para el negocio, hay dos
caminos, ambos de F2: bajar el intervalo de respaldo, o sincronizar el local
con la nube para que la copia sea continua.

Se dice aquí y no se esconde: es el límite real de este esquema.
