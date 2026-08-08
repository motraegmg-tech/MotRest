# Dar de alta la licencia de un restaurante

De principio a fin, con Rodizio como ejemplo.

---

## Lo que hay que entender antes de nada

Una licencia es **un archivo de texto firmado** que dice: *este local, hasta esta
fecha*. El Hub la lee del disco y comprueba la firma él solo, sin internet.

De ahí salen las dos únicas reglas que importan:

1. **El identificador del local tiene que coincidir exactamente.** La licencia de
   Rodizio no sirve en ningún otro equipo, ni siquiera en otro Rodizio. Si el
   identificador no coincide, el Hub la rechaza y **no la guarda**.
2. **La firma la hace la llave privada Ed25519 de Central.** El Hub solo tiene
   la pública, así que puede comprobarla pero no emitir una licencia. La privada
   vive cifrada con DPAPI en la máquina de MOTRAE.

> **El orden importa: primero se instala, después se emite.** El Hub genera su
> propio identificador al arrancar por primera vez. Emitir la licencia antes de
> saberlo es inventárselo — y eso no se descubre hasta que uno ya está en el
> restaurante con el archivo pegado y no pasa nada.

---

## Los cinco pasos, con Rodizio

### 1 · Instalar MotRest en la computadora del local

`MotRest_1.0.4_x64-setup.exe`, doble clic. No pide administrador.

Al primer arranque sin licencia aparece la pantalla **Servicio suspendido**. No
borra ni altera la información: muestra el código de instalación y permite pegar
la licencia firmada cuando Central la emita.

### 2 · Copiar el identificador que generó el Hub

En la pantalla **Servicio suspendido**, copie el **Código de instalación**. Si el
local ya tiene una licencia vigente, también aparece en **Administración → Hub**.
Sale algo como:

```
suc-rodizio-centro
```

Anótalo tal cual, con guiones y todo.

> El Hub fija un identificador único en su primer arranque, incluso sin operación
> registrada. Si MOTRAE quiere decidirlo de antemano, puede usar
> `MOTREST_SUCURSAL_ID=suc-rodizio-centro` antes de ese primer arranque.

### 3 · Dar de alta el restaurante en MOTRAE Central

**Restaurantes → + Alta**:

| Campo | Para Rodizio |
|---|---|
| Nombre | `Rodizio` |
| Sucursal | `Centro` |
| Identificador | `suc-rodizio-centro` ← **el del paso 2** |
| Plan | Mensual |
| Cuota | Lo que cobres |
| Responsable | Quien tendrá el control total del restaurante |

Central propone el identificador a partir del nombre. **Si el que muestra el Hub
es distinto, gana el del Hub** — cámbialo en el formulario.

Al guardar, Central crea al responsable como **Propietario**, muestra un PIN
inicial de ocho dígitos una sola vez y lo guarda cifrado como hash.

**No hace falta entregarlo.** Lo que el restaurante usa es el PIN que él elige la
primera vez que abre MotRest: la caja le enseña el nombre que capturaste aquí y le
pide su PIN. Guarda el de Central como repuesto —es lo que permite reponerle el
acceso desde MOTRAE si algún día se queda fuera—, y entrégalo solo en ese caso.

### 4 · Emitir la licencia

En la ficha del local, botón **«Emitir licencia»**. Sale el `licencia.json` en
pantalla, con un botón de copiar.

Lo que lleva dentro:

```json
{
  "sucursal_id": "suc-rodizio-centro",
  "nombre": "Rodizio",
  "plan": "mensual",
  "vence_ts": 1788743628768,
  "gracia_dias": 3,
  "emitida_ts": 1786065228769,
  "soporte": { "sal": "…", "hash": "…", "iteraciones": 600000 },
  "responsable": { "id": "usr-gonzalo", "nombre": "…", "credencial": { "hash": "…" } },
  "firma": "509b00ca418d00e407046bbcc82b8267…"
}
```

- `vence_ts` — hasta cuándo está pagada.
- `gracia_dias` — **3**. Al cuarto día el sistema se bloquea.
- `soporte` — el hash de la contraseña de soporte de MOTRAE. Es lo que hace que
  **Gonzalo DJA** pueda entrar desde «Acceso de soporte MOTRAE» sin aparecer
  entre el personal del restaurante.
- `responsable` — el perfil y hash del PIN inicial del responsable. Solo la
  caja lo recibe; las tablets no reciben esa credencial.
- `firma` — sobre todo lo anterior. Cambiar **cualquier** campo la invalida.

### 5 · Pegarla en el local

Si está en la pantalla **Servicio suspendido**, pegue el texto en **Licencia de
MOTRAE** y pulse **Activar licencia**. Si el local ya está abierto, también puede
hacerlo desde **Administración → Licencia** → pegar → guardar.

**Efecto inmediato.** No hay que reiniciar nada; si el equipo estaba bloqueado,
se desbloquea al momento.

Comprobación: **Administración → Hub** debe mostrar los días restantes.

---

## Desde la terminal, en un solo comando

Para cuando estás instalando con las manos ocupadas, o quieres dejarlo escrito
en un guion.

```powershell
# La llave privada entra por variable de entorno, NUNCA como argumento del comando:
# los argumentos quedan en el historial y en la lista de procesos de la máquina.
$env:MOTRAE_LLAVE_PRIVADA_LICENCIAS = "<respaldo seguro de MOTRAE; Central no la muestra>"
$env:MOTRAE_CONTRASENA_SOPORTE = "<tu contraseña fuerte de soporte>"

corepack pnpm@9.15.0 --filter @motrest/central licencia -- `
  --sucursal suc-rodizio-centro --nombre "Rodizio" --responsable "Responsable de Rodizio" --meses 1
```

Sale así:

```
  Licencia emitida para Rodizio
  Local:    suc-rodizio-centro
  Plan:     mensual
  Vence:    6 de septiembre de 2026 (30 días)
  Gracia:   3 días, y después el sistema se bloquea
  Soporte:  incluido (Gonzalo DJA puede entrar)
  Archivo:  licencia.json
  PIN inicial del responsable: ********
```

| Opción | Qué hace |
|---|---|
| `--sucursal` | **Obligatorio.** El identificador del Hub |
| `--nombre` | Cómo se lee en la licencia |
| `--responsable` | **Obligatorio.** Nombre de quien entra como Propietario |
| `--meses` | Cuántos pagó. `--meses 3` = tres meses |
| `--plan` | `mensual` (por defecto), `anual` o `prueba` |
| `--desde` | Renovar contando desde el vencimiento anterior |
| `--salida` | Dónde escribirlo (por defecto `licencia.json`) |

> Usa este comando para la **primera emisión**. Para renovar, usa MOTRAE Central:
> así conserva el PIN que el responsable ya haya cambiado.

Después se copia el archivo al equipo del local y se pega en **Licencia de
MOTRAE** de la pantalla suspendida, o desde **Administración → Licencia** si el
local ya está abierto.

---

## Renovar cada mes

Lo mismo, botón **«Renovar licencia»**. Cuenta **desde el vencimiento anterior**,
no desde hoy: pagar tres días antes no regala tres días, y pagar tarde no cobra
los días que estuvieron bloqueados.

Central te avisa solo. En **Hoy** aparecen los que vencen dentro de 7 días,
ordenados por urgencia.

---

## Qué pasa si no paga

| Estado | Cuándo | Qué ve el restaurante |
|---|---|---|
| Por vencer | 10 días antes | Aviso discreto |
| **Gracia** | 3 días tras vencer | Aviso visible, **todo funciona** |
| **Bloqueada** | Al cuarto día | Pantalla de MOTRAE. **Nada funciona** |

El bloqueo **no cae con un turno de caja abierto** — se espera al cierre. Sin
eso, el restaurante se quedaría sin poder cobrarles ni a los que están sentados,
y esa llamada te llega a ti.

Para reactivar: emitir licencia nueva y pegarla. Su información sigue intacta.

---

## Cuando algo no cuadra

| Síntoma | Qué pasó |
|---|---|
| «Esa licencia no es de este local» | El identificador no coincide. Copia el de **Administración → Hub** |
| Sigue diciendo que no tiene licencia | El Hub no trae la pública Ed25519 correspondiente, o se pegó una licencia HMAC anterior; reemite primero y actualiza después |
| «Acceso de soporte MOTRAE» no aparece o Gonzalo DJA no puede entrar | La licencia se emitió sin `soporte`. Define la contraseña de soporte en Central → Llaves y reemítela |
| El comando dice «La licencia emitida no se verifica» | La llave privada se pegó mal o no es Ed25519. Vuelve a copiarla desde Central |
