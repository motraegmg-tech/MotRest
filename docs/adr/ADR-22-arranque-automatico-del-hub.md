# ADR-22 — El Hub arranca solo con Windows

**Estado:** aceptado · **Fecha:** 2026-07-30

## Contexto

El Hub es el corazón del local: guarda el registro de eventos, asigna la
secuencia total y sincroniza las terminales. Hasta ahora **había que abrirlo a
mano**.

El ensayo del viernes lo destapó: durante la prueba el Hub dejó de responder y
al revisar por qué, no estaba registrado en ningún arranque de Windows. En un
restaurante eso significa que el día que se va la luz y la caja reinicia sola,
nadie se entera hasta que dos terminales dejan de verse a media cena — y el
diagnóstico desde el piso es "el sistema no jala", que es el peor de todos.

## Decisión

El Hub se registra a sí mismo en
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` la primera vez que arranca
correctamente desde su instalación real.

### Por qué el arranque de sesión y no un servicio de Windows

Un servicio arranca antes de que nadie entre, que suena mejor. Pero:

- exige **permisos de administrador** al instalar, y el instalador de MotRest
  hoy no los pide;
- necesita un **envoltorio de servicio** (el ejecutable tiene que hablar el
  protocolo del Service Control Manager), o una dependencia externa tipo NSSM;
- corre en una sesión **sin la carpeta del usuario**, que es justo donde viven
  `hub.sqlite`, los certificados TLS y el CSD.

La caja de un restaurante enciende y entra sola a su usuario. El arranque de
sesión llega igual de temprano, no pide permisos especiales y deja el Hub en la
misma sesión que la aplicación. Si algún día hace falta un servicio de verdad
—por ejemplo, un equipo dedicado sin sesión iniciada— esta decisión no lo
estorba: son mecanismos independientes.

### Visible y reversible

Un programa que se mete solo en el arranque y no lo dice es exactamente lo que
uno no quiere en la computadora de su negocio. Por eso:

- `/salud` reporta `arranque_automatico: { soportado, activo, motivo? }`;
- **Administración → Hub del local** lo muestra y tiene el interruptor;
- `POST /arranque-automatico {"activo": false}` lo apaga.

Como todo lo que toca la configuración de este equipo, el endpoint **solo
responde desde el propio equipo**: nadie en la wifi del local decide qué arranca
en la caja.

### Las dos guardas

Registrarse mal es peor que no registrarse, porque parece configurado y no
levanta nada. Se exige que se cumplan las dos condiciones:

1. **Que corra como su ejecutable instalado.** Con `tsx` en desarrollo,
   `process.execPath` es `node.exe`: registrar eso dejaría en el arranque de
   Windows un node suelto sin argumentos.
2. **Que use su base de datos, no una temporal.** El ensayo levanta el *mismo
   ejecutable instalado* sobre una carpeta temporal (`MOTREST_HUB_DB`). Sin esta
   guarda, cada ensayo dejaría a Windows arrancando un Hub que apunta a una
   carpeta ya borrada.

La ruta se **reescribe** si cambió: tras reinstalar o mover la aplicación, una
entrada que apunta a donde ya no está el ejecutable no sirve de nada.

El registro se hace **al final del arranque**, cuando todo lo demás ya levantó.
Registrar un Hub que no logra arrancar garantiza que falle todas las mañanas en
vez de una sola vez.

## Consecuencias

- La caja de Rodizio puede reiniciarse sin que nadie tenga que acordarse de
  nada.
- El arranque depende de que **alguien entre a Windows** en ese equipo. Si el
  local usa inicio de sesión automático —lo normal en una caja— es equivalente a
  un servicio. Si no, hay que activarlo en Windows o pasar a servicio.
- Es específico de Windows. En otra plataforma, `soportado` es `false` y se dice
  por qué, en vez de fallar en silencio.

## Alternativas descartadas

- **Servicio de Windows:** más robusto en teoría; requiere administrador,
  envoltorio y perder acceso a la carpeta del usuario. Queda para el día que
  haya un equipo dedicado.
- **Acceso directo en la carpeta Inicio:** equivalente en efecto, pero más
  frágil (el usuario lo borra sin saber qué era) y más difícil de consultar
  desde el propio programa para poder reportarlo.
- **Que el instalador escriba la entrada:** el instalador corre una vez; el Hub
  arranca siempre. Hacerlo desde el Hub repara la entrada si alguien la borra o
  si la aplicación se movió de sitio.
