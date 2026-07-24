; Ganchos del instalador NSIS de MotRest.
;
; El instalador copia archivos, pero no limpia: cada actualización deja en la
; terminal el POS de la versión anterior, porque el nombre del paquete lleva un
; sello distinto en cada compilación (index-XXXX.js). Se comprobó en una máquina
; real: once paquetes viejos acumulados, y entre ellos los de las versiones que
; todavía traían los usuarios de demostración con su PIN de fábrica. Nadie los
; carga —la página apunta solo al último— pero quedan legibles en el disco de la
; caja del restaurante, que es exactamente lo que no queremos.
;
; Se borra `pos` y NADA más. En particular NUNCA `datos`, que es donde vive
; `hub.sqlite`: ahí está la venta del local.

!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\pos"
!macroend
