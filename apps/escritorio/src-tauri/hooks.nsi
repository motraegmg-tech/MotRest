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

; --- El puerto del Hub en el firewall de Windows -------------------------------
;
; Sin esta regla, la tablet del salón no alcanza al Hub y el emparejamiento
; muere en «no se puede acceder a este sitio». Se dejaba al diálogo que Windows
; enseña la primera vez que un programa escucha, y eso falla de dos maneras: si
; alguien lo cierra sin leerlo no hay puerto, y cuando sí se acepta Windows crea
; la regla SOLO para el perfil de red activo en ese momento. Se vio en una
; máquina real: seis reglas acumuladas, todas de perfil `Public`, y ninguna
; sirve el día que el router clasifica la red como `Private`.
;
; `profile=any` es deliberado. La alternativa —limitarlo a `private`— deja fuera
; justo el caso que se observó. Lo que protege el Hub no es la topología de la
; red sino la clave del local: sin ella no se completa el emparejamiento, y el
; canal va cifrado. La regla se ata además al PROGRAMA, no solo al puerto.
;
; Va con `runas` porque el instalador es `currentUser` y no está elevado. Si el
; restaurante rechaza el aviso de Windows, la instalación NO se rompe: queda sin
; regla, igual que hasta ahora, y el ensayo desde la tablet lo delata enseguida.

!define MOTREST_REGLA_FW "MotRest Hub"

!macro NSIS_HOOK_POSTINSTALL
  ; Se borra antes de crear para no ir acumulando una regla por actualización.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${MOTREST_REGLA_FW}"'
  Pop $0

  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${MOTREST_REGLA_FW}" dir=in action=allow protocol=TCP localport=8787 profile=any program="$INSTDIR\motrest-hub.exe"'
  Pop $0
  StrCmp $0 "0" fw_listo 0

  ; Sin privilegios: se pide una vez, explicando qué se va a hacer.
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
    "Windows va a pedir permiso para abrir el puerto de MotRest.$\n$\nEs lo que permite que las tabletas del salón se conecten a la caja. Si lo cancela, la caja funcionará igual pero las tabletas no podrán emparejarse." \
    IDOK fw_elevar IDCANCEL fw_listo

  fw_elevar:
    ExecShellWait "runas" "netsh.exe" 'advfirewall firewall add rule name="${MOTREST_REGLA_FW}" dir=in action=allow protocol=TCP localport=8787 profile=any program="$INSTDIR\motrest-hub.exe"' SW_HIDE

  fw_listo:
!macroend

; Al desinstalar se retira la regla: un puerto abierto para un programa que ya
; no está es una puerta que nadie vigila.
!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${MOTREST_REGLA_FW}"'
  Pop $0
!macroend
