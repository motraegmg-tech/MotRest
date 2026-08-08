# ADR-24 · La licencia, el bloqueo y el acceso de soporte

**Estado:** aceptado · **Fecha:** agosto 2026 · **Decide:** Gonzalo (MOTRAE)

---

## Contexto

MotRest se cobra por **mensualidad por local**. Hacen falta dos cosas que hasta
ahora no existían: que un restaurante que deja de pagar deje de usar el software,
y que MOTRAE pueda entrar a resolver un problema sin depender de que alguien del
local esté disponible y sepa explicarlo.

Las dos tocan la confianza del cliente, así que conviene dejar por escrito qué se
decidió y por qué.

---

## Decisión 1 · Tres días de gracia, y después el software queda inservible

| Estado | Cuándo | Qué pasa |
|---|---|---|
| **Activa** | Al corriente | Nada. Ni un aviso. |
| **Por vencer** | 10 días antes | Aviso discreto. Todo funciona. |
| **Gracia** | Vencida, 3 días | Aviso visible. **Todo sigue funcionando.** |
| **Bloqueada** | Al cuarto día | Pantalla de MOTRAE. **Nada funciona.** |

La gracia son **tres días** y durante ellos no estorba nada. Un aviso que bloquea
a medias es lo peor de los dos mundos: ni cobra ni deja trabajar.

### La única concesión, y por qué existe

**El bloqueo no cae con un turno de caja abierto.** Se difiere hasta que cierren.

No es suavizar el cobro. Bloquear con doce mesas abiertas encierra ese dinero: el
restaurante no puede cobrarle **ni a los que están sentados**, y esa llamada de
auxilio a las diez de la noche le llega a MOTRAE, no al moroso. Difiriendo al
cierre pierden igual el servicio siguiente, que es a las pocas horas.

Se puede apagar por licencia (`bloqueo_inmediato`) si en algún caso conviene.

### Sobre sus datos

El restaurante bloqueado **no puede exportar**, pero MOTRAE le entrega su
información en cuanto la pida, desde Central. Sus ventas son suyas y las necesita
para el SAT; retenerlas no sería una palanca de cobro, sería un problema legal.
**Lo que se suspende es el uso del software, no la propiedad de la información.**

### Se comprueba sin internet

La licencia es un documento firmado que el Hub lee del disco. No hay llamada a
ningún servidor al arrancar: **si MOTRAE se cae, los restaurantes al corriente
abren igual**. Depender de nuestra disponibilidad para que ellos vendan sería
cambiar un riesgo suyo por uno nuestro, y el suyo cuesta un servicio entero.

Vive **junto a la base de datos**, no junto al ejecutable: los archivos de
programa se reemplazan al actualizar, y una licencia ahí desaparecería con cada
versión nueva.

---

## Decisión 2 · El acceso de soporte «Gonzalo DJA»

Existe un usuario en **cada instalación con licencia de soporte** que no aparece en ninguna lista
del restaurante. Sirve para que MOTRAE entre a resolver un problema sin pedirle a
nadie su contraseña.

La pantalla lo ofrece únicamente como **Acceso de soporte MOTRAE**, separado del
personal del local; su nombre sigue siendo visible en la bitácora.

### Por qué esto no es una puerta trasera

La diferencia no está en si el acceso existe —lo tiene cualquier proveedor de
software administrado— sino en **si se puede auditar y si el cliente lo sabe**:

1. **La credencial no está en el código.** Viaja dentro de la licencia firmada y
   la elige Gonzalo en Central. Nadie que lea el repositorio puede entrar, y
   nadie que edite un archivo puede fabricarse un usuario con estos poderes: sin
   la firma de MOTRAE, la licencia no vale.

2. **Todo queda registrado y nadie puede borrarlo.** La bitácora es el event log,
   que solo agrega. Que el usuario esté oculto en las **listas** no lo oculta en
   la bitácora: se filtra en las pantallas de personal, nunca en la auditoría.
   Ni MOTRAE puede tapar sus propios pasos.

3. **Va declarado en el contrato.** Un acceso de mantenimiento que el cliente
   conoce y aceptó es soporte. Uno que no conoce es otra cosa.

### Detalles que no son casualidad

- **Rango 120, por encima del propietario.** Como nadie administra a un rango
  mayor, el restaurante no puede desactivarlo ni borrarlo. Eso también **protege
  al restaurante**: impide que un empleado enojado deje al local sin vía de
  auxilio la noche que se rompe algo.
- **No sale entre los roles que pueden autorizar.** Es el escondite que se
  olvida: un rol que asoma en el diálogo de "pide autorización a…" delata su
  existencia en la pantalla que ve cualquier mesero.
- **El hash solo llega a la caja**, nunca a las tablets del salón. A una tablet
  no le sirve de nada y sí es material para adivinar con calma la contraseña que
  abre todos los restaurantes.
- **Es el único que puede entrar a un local bloqueado.** Si al vencer la licencia
  nadie pudiera entrar, tampoco podría entrar quien va a reactivarla. Un bloqueo
  del que ni el proveedor puede salir es un ladrillo.

### Cláusula para el contrato

> **Acceso de mantenimiento.** El software incluye una cuenta técnica del
> proveedor (MOTRAE) para atender incidencias, aplicar configuraciones y
> restablecer el servicio. Toda actuación realizada con esa cuenta queda
> registrada en la bitácora del sistema, accesible para el cliente, y no puede
> ser borrada ni modificada. El proveedor no accede a los datos del cliente para
> ninguna finalidad distinta del soporte contratado.

---

## Consecuencias

**A favor**

- La mensualidad se cobra sola, sin perseguir a nadie.
- El restaurante nunca se queda a medias de un servicio por culpa nuestra.
- El soporte se resuelve en minutos en vez de por teléfono.
- La cuenta de soporte es imposible de falsificar y de tapar.

**En contra, y asumido**

- Un restaurante bloqueado no puede sacar sus datos por su cuenta. Se compensa
  entregándoselos desde Central en cuanto los pida.
- Quien tenga la **llave privada Ed25519** de licencias puede emitir licencias
  gratis. La pública que viaja al Hub no puede hacerlo; la privada vive cifrada
  con DPAPI en Central (ver `Llaves`).
- Si se pierde la privada, hay que generar un par nuevo, compilar un Hub con su
  pública y reemitir licencias. El respaldo DPAPI separado es obligatorio.

La migración y el orden seguro de despliegue están fijados en
[`ADR-25-firmas-ed25519-y-migracion.md`](ADR-25-firmas-ed25519-y-migracion.md).

---

## Alternativas descartadas

**Comprobar la licencia contra un servidor al arrancar.** Habría convertido una
caída de MOTRAE en una caída simultánea de todos los restaurantes.

**Bloquear todo menos vender.** Fue el primer diseño. Gonzalo lo cambió: un
bloqueo con excepciones es un bloqueo que se ignora, y quien puede seguir
vendiendo no tiene prisa por pagar.

**Meter la contraseña de soporte en el código.** Se leería en el repositorio, y
cambiarla exigiría publicar una versión nueva.
