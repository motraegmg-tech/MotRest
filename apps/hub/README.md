# @motrest/hub — STUB

Servicio de fondo del local (no la UI): base de datos canónica del restaurante y
árbitro del sistema (folios consecutivos, un solo corte válido, orden total del
event log). Topología hub-and-spoke (TRD §4.1, ADR-01).

**Aún sin implementar.** Se construye en un paso posterior de F1:
- Fastify + WebSocket (TLS) sobre LAN, descubrimiento por mDNS.
- `better-sqlite3` (SQLite WAL) como base canónica: event log + proyecciones.
- Reutiliza `@motrest/dominio` (tipos, eventos y reducers compartidos con los clientes).
- Empaquetado como servicio de Windows (ADR-07).
