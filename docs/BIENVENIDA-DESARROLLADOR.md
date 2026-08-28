# Bienvenida al desarrollo de MotRest

Este documento es lo primero que lee quien se incorpora a programar en MotRest. Va de lo
general a lo concreto: qué es el producto, qué leer, cómo dejar la máquina lista, cómo
arrancar el sistema, cómo se trabaja y qué reglas no se negocian.

Si al terminar puedes levantar el Hub y el POS en tu computadora y abrir una comanda, ya
estás dentro.

**Versión 1.0 · agosto de 2026 · MotRest 1.3.4**

---

## 1 · Qué estás por tocar

MotRest es el **ERP de un restaurante**, no un punto de venta con extras. Vende, manda a
cocina, controla inventario y costos, y encima de eso lleva finanzas, personal y compras.
Lo hace MOTRAE (Xalapa, Veracruz) y hoy corre **en producción, todos los días, en un
restaurante real: Rodizio**.

Eso último cambia cómo se programa aquí. No es un proyecto en el que un error se descubre
en una demo: se descubre un viernes a las nueve de la noche, con mesas llenas y una fila
en la caja. Dos consecuencias prácticas:

- **Nada se da por bueno porque «funciona en dev».** Lo que importa es lo que hace la
  aplicación instalada, con su impresora USB, su red y su base de datos.
- **La compatibilidad hacia atrás importa de verdad.** Hay restaurantes con versiones
  anteriores instaladas que se actualizan solos. Un cambio que rompe el formato de un
  evento guardado no rompe una prueba: rompe un local.

### La arquitectura en un párrafo

MotRest es **LAN-first**. En la caja del restaurante vive el **Hub**: un servidor Node que
guarda todo en un registro de eventos (SQLite) y habla por WebSocket seguro con las
terminales. Las terminales —POS en tablets, pantalla de cocina, portal del comensal— son
clientes web que **funcionan aunque se caiga internet**, porque el que manda está en la
misma red. Fuera del local sólo hay un **relay** (en Fly.io) que hace de cartero para
licencias y enlaces del portal: no es la autoridad, no guarda las ventas.

El detalle está en el TRD. Léelo antes de proponer arquitectura.

---

## 2 · Qué leer, y en qué orden

No leas el código primero. Este proyecto documenta el **porqué** de sus decisiones, y sin
eso vas a proponer cambios que ya se descartaron con razón.

| Orden | Documento | Para qué |
|---|---|---|
| 1 | [`README.md`](../README.md) | El producto y el negocio. Fuente de verdad. |
| 2 | [`CLAUDE.md`](../CLAUDE.md) | Guía operativa corta de la carpeta. |
| 3 | [`MOTRAE_MotRest_PRD.md`](../Documentos_de_Primer_Orden/MOTRAE_MotRest_PRD.md) | Alcance funcional: qué debe hacer el sistema. |
| 4 | [`MOTRAE_MotRest_TRD.md`](../Documentos_de_Primer_Orden/MOTRAE_MotRest_TRD.md) | Arquitectura, stack, modelo de datos, sincronización. |
| 5 | [`docs/adr/`](adr/) | Las decisiones difíciles, una por archivo, con su razón. |
| 6 | [`docs/SEGURIDAD.md`](SEGURIDAD.md) | El modelo de amenazas. **Obligatorio** antes de tocar licencias, firmas o el relay. |

Y cuando vayas a trabajar en un área concreta, hay un documento de relevo por tema en
[`docs/`](.) —impresión, licencias, actualización remota— que cuenta qué se intentó y qué
falló. Búscalo antes de empezar; te ahorra días.

---

## 3 · Preparar la máquina

### 3.1 · Lo que necesitas instalado

| Herramienta | Versión | Nota |
|---|---|---|
| **Node.js** | **24.16.0** exacta | La fija [`.nvmrc`](../.nvmrc). Usa `nvm` o `fnm` para clavarla. |
| **pnpm** | **9.15.0**, vía Corepack | Ver abajo. No lo instales global. |
| **Git** | reciente | |
| Editor | VS Code recomendado | El proyecto es TypeScript + Svelte. |

**Por qué Node 24 y no «20 o superior».** El Hub usa `node:sqlite`, que no existe antes de
Node 22. Un Node 20 pasa cualquier comprobación laxa y luego **falla al arrancar en el
restaurante**. Instala la versión del `.nvmrc` y no la negocies.

### 3.2 · pnpm sólo por Corepack

Este es el error número uno de quien llega nuevo. **No hagas `npm install -g pnpm`.** Todos
los comandos de este repositorio se invocan así:

```bash
corepack pnpm@9.15.0 <lo que sea>
```

Corepack viene con Node y descarga esa versión exacta. Así la máquina que compila un
instalador usa el mismo resolvedor que el CI y que la tuya, y el `pnpm-lock.yaml` significa
lo mismo en todas.

Si Corepack te pide confirmación interactiva la primera vez, acepta. En un runner sin
terminal eso colgaría el flujo; por eso el CI lleva `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.

### 3.3 · Clonar e instalar

```bash
git clone https://github.com/motraegmg-tech/MotRest.git
cd MotRest
corepack pnpm@9.15.0 install
```

El [`.npmrc`](../.npmrc) fija `frozen-lockfile=true` a propósito: **nunca vas a resolver
versiones distintas de las auditadas**. Si el `install` te falla pidiendo actualizar el
lockfile, es porque cambiaste una dependencia — eso es un cambio deliberado que va en su
propio commit, no un tropiezo que se arregla con `--no-frozen-lockfile`.

---

## 4 · Arrancar el sistema en local

Son dos procesos, en dos terminales. Primero el Hub, después el POS.

### Terminal 1 — el Hub

```bash
corepack pnpm@9.15.0 --filter @motrest/hub dev
```

Levanta dos puertos:

- **8787** — HTTPS + WSS, con certificado autofirmado. Es el que usan las tablets de la red.
- **8788** — HTTP plano, **sólo en `127.0.0.1`**, para que tú no pelees con el certificado.

Al arrancar imprime en consola una URL con una clave local (`&k=…`). Cópiala tal cual: es
la que autoriza a la terminal contra el Hub.

Puedes mover el puerto con `MOTREST_HUB_PUERTO` si el 8787 ya está ocupado.

### Terminal 2 — el POS

```bash
corepack pnpm@9.15.0 dev:pos
```

Abre en **https://localhost:5173**. Sí, HTTPS, y sí, va a mostrar un aviso de certificado
que tienes que aceptar. **No es un descuido:** el navegador sólo expone `crypto.subtle` en
contextos seguros, y sin él no se pueden verificar PIN ni contraseñas, ni cifrar el canal
con el Hub, ni sellar el corte de caja. Una tablet abierta en `http://192.168.x.x:5173` se
quedaba sin las tres cosas. En la aplicación instalada el problema no existe.

### Comprobar que todo está sano

```bash
corepack pnpm@9.15.0 -r lint     # typecheck de todos los paquetes
corepack pnpm@9.15.0 -r test     # vitest en todos los paquetes
corepack pnpm@9.15.0 auditoria   # avisos de seguridad en dependencias de producción
```

Los dos primeros son exactamente lo que corre el CI en cada push. Si fallan en tu máquina,
van a fallar allá.

---

## 5 · El mapa del monorepo

Workspace pnpm: todo lo de `apps/*` y `packages/*`. Los paquetes internos se enlazan con
`workspace:*`, que pnpm resuelve **estrictamente dentro del repositorio** y falla si no lo
encuentra, en vez de caer al registro público.

### `apps/` — lo que se ejecuta

| Carpeta | Qué es |
|---|---|
| `hub/` | **El corazón.** Servidor del local: eventos, sync, licencia, impresión, portal, respaldo. |
| `pos-ui/` | El punto de venta (Svelte). Lo que tocan meseros y cajeros. |
| `escritorio/` | Empaquetado Tauri del POS + Hub: el instalador que va al restaurante. |
| `central/` | MotRest Central — el panel de MOTRAE: licencias, altas, llaves. |
| `central-escritorio/` | Empaquetado de Central. |
| `portal/` | Portal del comensal (el del código QR de la mesa). |
| `kds-android/` | Pantalla de cocina como app Android (Capacitor). |
| `motrest-android/` | El POS como app Android. |
| `relay/` | El servicio en Fly.io: cartero de licencias y enlaces del portal. |

### `packages/` — lo que se comparte

| Carpeta | Qué es |
|---|---|
| `dominio/` | **Las reglas del negocio.** Comandas, caja, inventario, costeo, fiscal, personal, identidad. Sin UI y sin red. |
| `protocolo-sync/` | El contrato de sincronización entre Hub y terminales. |
| `impresion/` | Generación de comandas y tickets para impresoras térmicas. |
| `ui/` | Componentes compartidos. |

**Empieza por `packages/dominio`.** Si entiendes el modelo de eventos de ahí, el resto del
sistema se lee solo.

---

## 6 · Cómo se trabaja

### Ramas y entregas

- **Nunca se commitea directo a `main`.** Sin excepciones.
- Ramas con prefijo: `feature/…`, `fix/…`, `docs/…`, en español y descriptivas.
- El trabajo entra por **Pull Request** contra `main`, con el CI en verde.
- Un cambio, una rama. Nada de ramas que arrastran tres temas.

```bash
git checkout main
git pull
git checkout -b feature/lo-que-vas-a-hacer
```

### Idioma y estilo

Todo en **español**: nombres de variables, funciones, commits, comentarios y documentos.
No es capricho — el equipo y los documentos del negocio están en español, y mezclar los dos
idiomas en el mismo archivo hace que nadie encuentre nada.

Los comentarios de este repositorio explican **por qué**, no qué. Si abres un archivo y ves
párrafos largos sobre una decisión, eso es el estándar: cuando algo se hace de una forma
rara, hay una razón cara detrás y se deja escrita para que nadie la deshaga por limpieza.

### Antes de abrir el PR

1. `corepack pnpm@9.15.0 -r lint` en verde.
2. `corepack pnpm@9.15.0 -r test` en verde.
3. Pruebas nuevas para lo que agregaste.
4. Revisa tu propio diff archivo por archivo. Sobre todo, mira **qué archivos** entraron.

---

## 7 · Las reglas que no se negocian

### 7.1 · Ningún secreto entra al repositorio. Nunca.

El [`.gitignore`](../.gitignore) bloquea por extensión (`*.key`, `*.crt`, `*.pfx`, `*.pass`,
`id_rsa*`, `.env`) precisamente porque las reglas por ruta sólo protegen mientras nadie
mueva un archivo de sitio para depurar.

Aun así, **la última barrera eres tú**:

> **No uses `git add -A` ni `git add .` en este repositorio.**
> Commitea por lista explícita: `git add ruta/uno.ts ruta/dos.ts`.

Lo que está en juego no es una contraseña de prueba. En este proyecto hay material que, en
malas manos, permite **facturar a nombre del restaurante** (el CSD del SAT) o **firmar un
instalador que se distribuye solo a toda la cartera**. Un secreto filtrado no se arregla
borrándolo: hay que rotarlo en cada local.

Si crees que subiste algo por error, **no lo borres con otro commit y sigas**. Avisa a
Gonzalo de inmediato: en Git, borrar en un commit posterior no borra nada.

### 7.2 · Nada de tocar producción por tu cuenta

Instalar en un restaurante, publicar una actualización, desplegar el relay o firmar un
instalador son operaciones que **hace Gonzalo**. Están documentadas en `docs/` para que
entiendas el proceso completo, no para que lo ejecutes. Si tu cambio necesita llegar a un
local, se coordina.

### 7.3 · Las dependencias nuevas se justifican

Se cierra cada aviso de `pnpm audit` en lugar de acumularlos, y la línea base hoy está
limpia. La máquina que compila es la misma que guarda las llaves de firma de toda la
cartera: comprometerla es comprometer a todos los clientes. Una dependencia nueva se
discute antes, no se descubre en el PR.

---

## 8 · Integración continua

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) corre en cada push y cada PR:
instala con lockfile congelado, hace lint de todos los paquetes y corre todas las pruebas.
Hay además una auditoría semanal de dependencias.

El flujo tiene permisos de **sólo lectura** sobre el repositorio, y las acciones de terceros
están ancladas por hash de commit en vez de por etiqueta. Si agregas un paso, mantén las dos
cosas.

---

## 9 · Dudas

Con **Gonzalo** (CEO de MOTRAE) — motrae.gmg@gmail.com.

Y una regla del README que aplica igual al código: **si algo de lo que encuentras contradice
la documentación, pregunta antes de asumir.** Casi siempre es que hay un motivo escrito en
algún lado, y a veces es que el documento se quedó atrás. Las dos cosas conviene saberlas.
