# Dar acceso por internet a un restaurante (MotRest 1.6.0)

Guía para MOTRAE. Decisiones y diseño: [ADR-29](adr/ADR-29-motrest-en-la-web.md).

## Una sola vez: publicar la web

1. En Vercel, crea un proyecto desde el repositorio `motraegmg-tech/MotRest`, con
   **Root Directory** `apps/pos-ui`. Todo lo demás lo lee de `apps/pos-ui/vercel.json`:
   instala con pnpm y compila con `pnpm run build:web`, que deja el resultado en
   `dist-web/`.
   - No hacen falta variables: los tres valores públicos van por defecto en
     `vite.config.ts`.
   - El plan Hobby de Vercel **no permite uso comercial**. Para restaurantes que pagan
     hace falta Pro.
2. En Supabase → Edge Functions → Secrets, pon `MOTREST_WEB_ORIGENES` con la dirección
   de la web (por ejemplo `https://motrest.vercel.app`). Sin ella, la entrada contesta
   a cualquier origen.
3. En Central → **Llaves** → «MotRest en la web», guarda esa misma dirección.

## Por restaurante

1. En Central, en el **Alta** o en **Editar datos** → «Acceso por internet», elige:
   - **Ambas**: tiene computadora con MotRest, y además entra por la web.
   - **Nube**: no tiene computadora. Solo se puede elegir antes de emitir su primera
     licencia.
2. Revisa la **clave** («RODIZIO»); «Sugerir» propone una a partir del nombre. Pulsa
   **Aplicar**. La contraseña se genera sola; con **Ver** la enseñas y con **Copiar**
   la pegas en el mensaje al cliente.
3. **Emite la licencia.** La modalidad viaja dentro de ella.
   - En «ambas», el Hub necesita además la llave del túnel. Central la manda sola; si
     el Hub todavía no había dado señal, usa «Reenviar la llave del túnel al Hub»
     cuando aparezca en «Hoy».
4. Dale al restaurante la dirección de la web, su clave y su contraseña.

## Cambiar o ver la contraseña

- **Desde Central:** «Generar otra» o «Escribir una». Se cierran todas las sesiones
  abiertas por la web.
- **Desde el restaurante:** el propietario va a Administración → «Acceso por
  internet».
  - Desde la web le pide la contraseña actual.
  - Desde la caja, no.
- **Central recoge la nueva** al actualizar el estado de los locales, y la sigue
  enseñando con «Ver».

## Qué no funciona en «nube»

- Timbrar con FacturAPI, el portal de autofactura, WhatsApp y el respaldo local:
  necesitan una computadora en el restaurante.
- **Impresión:**
  - En una computadora o un Android con Chrome: Administración → Impresoras →
    «Impresoras de este dispositivo» (USB, puerto serie o Bluetooth). El cajón se abre
    como siempre.
  - En iPad o iPhone: solo el cuadro de imprimir del sistema (AirPrint), y sin cajón.
    Es una limitación de Safari.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| «Clave o contraseña incorrecta» con los datos buenos | El acceso se apagó en Central (modalidad «app»), o hubo 10 intentos fallidos en la última hora con esa clave |
| «Tu restaurante no está conectado ahora mismo» (ambas) | La computadora del local está apagada o sin internet, o su Hub es anterior a la 1.6.0 |
| «…quedó a medio actualizar. Llama a MOTRAE» | La contraseña cambió en Auth pero no su envoltura. En Central, «Generar otra» lo arregla |
| En «Hoy» el local en nube sale sin señal | Nadie ha entrado todavía por la web: el pulso lo manda el dispositivo al entrar y al cerrar la caja |
