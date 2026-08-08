# MotRest 1.1.0 — Rodizio

Instalador para actualizar MotRest en la computadora de caja de Rodizio.
Se instala **sobre la versión anterior**: conserva los datos, la licencia y la
configuración del restaurante.

## Qué cambia en esta versión

**Ya no hay ninguna clave que MOTRAE tenga que entregar.** La primera vez que
MotRest abra después de actualizar, pedirá crear la cuenta del responsable del
restaurante: su nombre y el PIN que él elija. Con eso queda dentro y con acceso a
todo el sistema.

De ahí en adelante, cada vez que se abra MotRest aparecerá **la lista del
personal** y cada uno entra marcando su PIN.

Tres consecuencias que se notan en el uso diario:

1. **La cuenta del dueño lleva su nombre.** Antes decía «Gonzalo DJA», que es el
   nombre del soporte de MOTRAE y no el del responsable de Rodizio. Al crear la
   cuenta, esa misma cuenta queda con el nombre real; no se crea una segunda ni
   se pierde nada de lo que ya está registrado a su nombre.
2. **Ya no hay que apuntar una contraseña que el sistema inventa.** El PIN lo
   elige el responsable, así que lo recuerda.
3. **Al abrir MotRest siempre se pide identificarse.** Antes la caja amanecía con
   la sesión de la noche anterior puesta. Recargar la pantalla no echa a nadie
   fuera; cerrar y volver a abrir la aplicación, sí.

El responsable da de alta a su personal en **Administración → Usuarios**. A cada
empleado se le pone un PIN inicial y MotRest le pide cambiarlo la primera vez que
entra, para que su PIN sea solo suyo y la bitácora signifique algo.

## Instalación

1. Cierra MotRest si está abierto.
2. Ejecuta `MotRest_1.1.0_x64-setup.exe`. No pide permisos de administrador.
3. Abre MotRest normalmente al terminar.
4. En la primera pantalla, escribe el nombre del responsable y su PIN (de 4 a 8
   dígitos). Ese PIN también firma cancelaciones, descuentos y retiros de caja.

Si Windows muestra una advertencia de editor desconocido, es porque el instalador
todavía no cuenta con firma Authenticode comercial. Comprueba el hash de
`SHA256SUMS.txt` antes de instalar.

---

## Nota técnica para MOTRAE

**El Hub NO cambió en esta versión.** El cambio es enteramente del punto de venta,
así que este instalador lleva el mismo binario del Hub que la 1.0.4 —el que ya
verifica la licencia de Rodizio— byte por byte, y no se volvió a empaquetar. Por
eso **Administración → Hub** seguirá reportando `1.0.4`, y es correcto.

Consecuencia, y es la única: **este `.exe` no se publica en GitHub Releases como
1.1.0.** Si esa versión se va a publicar por el canal de actualización, hay que
compilarla completa para que el Hub también reporte 1.1.0:

```
$env:MOTREST_LICENCIA_PUBLICA=<Central → pública de licencias>
$env:MOTREST_ACTUALIZACIONES_PUBLICA=<Central → pública de publicación>
corepack pnpm@9.15.0 --filter @motrest/escritorio build
```

Publicar este binario tal cual dejaría a los Hubs ofreciendo 1.1.0 para siempre,
porque el que compara versiones es el Hub, no la ventana.

**El PIN del responsable que muestra Central al emitir la licencia sigue
sirviendo,** pero ya no hace falta entregarlo: queda como repuesto para reponerle
el acceso si algún día se queda fuera. Lo que el perfil firmado sí sigue mandando
es el **nombre** del responsable — si la licencia lo trae, la pantalla de alta lo
enseña y solo pide el PIN.

**La tablet se queda como está, y hay que saber por qué.** El APK **empaqueta** su
propia copia del punto de venta (`motrest-android/preparar.mjs` copia
`pos-ui/dist` a `www/`), así que no recibe este cambio por estar la caja
actualizada: necesitaría un APK nuevo.

No se incluye aquí a propósito, porque el inicio de sesión en tablet tiene un
hueco anterior a este cambio y conviene resolverlo antes de empaquetar otra:
**los hashes de las credenciales no se sincronizan.** Viven en el almacén de cada
dispositivo, así que el PIN que un mesero recibe en la caja no lo deja entrar en la
tablet. Hasta ahora eso quedaba tapado por un efecto secundario —cada tablet se
generaba su propia contraseña de propietario y la enseñaba una vez—, que es
justamente lo que esta versión retira. El camino que pide el TRD §10 es que el
**Hub** sea la fuente canónica que verifica las credenciales; mientras eso no
exista, la tablet solo sirve para lo que no pide identificarse.
