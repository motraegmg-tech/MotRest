# Portal de Autofactura (MOTRAE)

Aplicación pública (Vercel) para que los comensales soliciten su factura escaneando el código QR impreso en sus tickets de consumo.

## Arquitectura y Seguridad
El portal cumple estrictamente con el principio de que la llave de FacturAPI (para emitir CFDI) nunca abandone el "Hub" (servidor en el restaurante). Por ende, el portal:
1. No timbra.
2. Captura los datos fiscales y los empaqueta en un **Sobre Cifrado** (X25519) que únicamente puede abrir el Hub local del restaurante.
3. Lo deposita en la base de datos (Supabase) usando la llave de `service_role`.

## Variables de Entorno

Para levantar el portal en local o en producción, necesitas configurar `.env.local`:

```env
SUPABASE_URL=https://<TU_PROYECTO>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ey...
```

> **IMPORTANTE**: Jamás exponer `SUPABASE_SERVICE_ROLE_KEY` al lado del cliente (`NEXT_PUBLIC_...`). Solo debe usarla el _Server Action_ `solicitarFactura`.

## Scripts

- `pnpm dev`: Inicia el servidor de desarrollo en `localhost:3000`.
- `pnpm build`: Empaqueta la aplicación para producción.
- `pnpm test`: Ejecuta la suite de Vitest para comprobar reglas de límite, control de carreras y el cifrado del sobre.
