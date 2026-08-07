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
2. **La firma la hace tu secreto.** Sin él no se emite nada, y con él se emite
   todo. Vive solo en tu máquina.

> **El orden importa: primero se instala, después se emite.** El Hub genera su
> propio identificador al arrancar por primera vez. Emitir la licencia antes de
> saberlo es inventárselo — y eso no se descubre hasta que uno ya está en el
> restaurante con el archivo pegado y no pasa nada.

---

## Los cinco pasos, con Rodizio

### 1 · Instalar MotRest en la computadora del local

`MotRest_1.0.0_x64-setup.exe`, doble clic. No pide administrador.

Al primer arranque, MotRest **funciona con normalidad** y avisa de que no tiene
licencia. Es a propósito: arrancar bloqueado el día de la instalación, justo
cuando estás ahí montándolo, no tendría ningún sentido.

### 2 · Copiar el identificador que generó el Hub

En la caja: **Administración → Hub**. Sale algo como:

```
suc-rodizio-centro
```

Anótalo tal cual, con guiones y todo.

> Si el Hub aún no tiene operación registrada, puede mostrar `suc-local`. En ese
> caso fija tú el identificador antes del primer arranque con la variable de
> entorno `MOTREST_SUCURSAL_ID=suc-rodizio-centro`, y ya no cambia.

### 3 · Dar de alta el restaurante en MOTRAE Central

**Restaurantes → + Alta**:

| Campo | Para Rodizio |
|---|---|
| Nombre | `Rodizio` |
| Sucursal | `Centro` |
| Identificador | `suc-rodizio-centro` ← **el del paso 2** |
| Plan | Mensual |
| Cuota | Lo que cobres |
| Contacto | Quien manda ahí, con su teléfono |

Central propone el identificador a partir del nombre. **Si el que muestra el Hub
es distinto, gana el del Hub** — cámbialo en el formulario.

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
  "firma": "509b00ca418d00e407046bbcc82b8267…"
}
```

- `vence_ts` — hasta cuándo está pagada.
- `gracia_dias` — **3**. Al cuarto día el sistema se bloquea.
- `soporte` — el hash de **tu** contraseña. Es lo que hace que «Gonz Motrae»
  exista en ese MotRest.
- `firma` — sobre todo lo anterior. Cambiar **cualquier** campo la invalida.

### 5 · Pegarla en el local

En la caja: **Administración → Licencia** → pegar → guardar.

**Efecto inmediato.** No hay que reiniciar nada; si el equipo estaba bloqueado,
se desbloquea al momento.

Comprobación: **Administración → Hub** debe mostrar los días restantes.

---

## Desde la terminal, en un solo comando

Para cuando estás instalando con las manos ocupadas, o quieres dejarlo escrito
en un guion.

```powershell
# El secreto entra por variable de entorno, NUNCA como argumento del comando:
# los argumentos quedan en el historial y en la lista de procesos de la máquina.
$env:MOTRAE_SECRETO_LICENCIAS = "<Central → Llaves → Firma de licencias>"
$env:MOTRAE_CONTRASENA_SOPORTE = "<tu contraseña de Gonz Motrae>"

corepack pnpm@9.15.0 --filter @motrest/central licencia -- `
  --sucursal suc-rodizio-centro --nombre "Rodizio" --meses 1
```

Sale así:

```
  Licencia emitida para Rodizio
  Local:    suc-rodizio-centro
  Plan:     mensual
  Vence:    6 de septiembre de 2026 (30 días)
  Gracia:   3 días, y después el sistema se bloquea
  Soporte:  incluido (Gonz Motrae puede entrar)
  Archivo:  licencia.json
```

| Opción | Qué hace |
|---|---|
| `--sucursal` | **Obligatorio.** El identificador del Hub |
| `--nombre` | Cómo se lee en la licencia |
| `--meses` | Cuántos pagó. `--meses 3` = tres meses |
| `--plan` | `mensual` (por defecto), `anual` o `prueba` |
| `--desde` | Renovar contando desde el vencimiento anterior |
| `--salida` | Dónde escribirlo (por defecto `licencia.json`) |

Después se copia el archivo al equipo del local, junto a la base de datos, o se
pega desde **Administración → Licencia**.

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
| Sigue diciendo que no tiene licencia | Falta `MOTREST_LICENCIA_LLAVE` en el equipo, o no coincide con el secreto que firmó |
| «Gonz Motrae» no puede entrar | La licencia se emitió sin `soporte`. Reemítela con la contraseña definida |
| El comando dice «La licencia emitida no se verifica» | El secreto se pegó con un salto de línea o un espacio. Vuelve a copiarlo |
