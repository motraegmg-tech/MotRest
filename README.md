# MotRest · instaladores

Este repositorio **solo publica los instaladores de MotRest** (el punto de venta
y ERP restaurantero de MOTRAE). El código fuente no vive aquí.

Cada versión trae dos archivos:

- `MotRest_<versión>_x64-setup.exe` — el instalador para Windows.
- `motrest.json` — el manifiesto de la versión, **firmado con Ed25519** por
  MOTRAE. Los Hubs de los restaurantes verifican esa firma y el SHA-256 del
  instalador antes de instalar nada; un archivo que no corresponda a su
  manifiesto firmado se rechaza.

Contacto: MOTRAE.
