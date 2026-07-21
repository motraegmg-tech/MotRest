# @motrest/protocolo-sync — STUB

Sincronización en dos niveles (TRD §5.2, ADR-05):

1. **Dispositivo ↔ Hub**: protocolo LAN propio y delgado (replicación del event log
   con números de secuencia por dispositivo + snapshots versionados de catálogo).
2. **Hub ↔ Nube**: PowerSync, con el hub como único cliente por local.

**Aún sin implementar.** Se construye tras el núcleo del hub.
