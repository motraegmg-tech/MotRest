# Recoge el estado de una caja para diagnosticarla desde fuera.
#
# SOLO LEE. No escribe en la base, no reinicia el Hub, no cambia configuracion:
# se corre en un restaurante que esta operando y no puede interrumpir la venta.
#
# Lo que NO se lleva, a proposito: el hash del PIN de la licencia y la clave del
# local. Un diagnostico no necesita secretos, y un archivo de diagnostico acaba
# viajando por correo.
#
#   powershell -ExecutionPolicy Bypass -File recoger-diagnostico.ps1
#
# Deja una carpeta en el Escritorio con todo dentro.

$ErrorActionPreference = "Continue"
$datos = Join-Path $env:LOCALAPPDATA "MotRest\datos"
$salida = Join-Path ([Environment]::GetFolderPath("Desktop")) ("diagnostico-motrest-" + (Get-Date -Format "yyyyMMdd-HHmm"))
New-Item -ItemType Directory -Path $salida -Force | Out-Null

function Escribir($nombre, $contenido) {
  $contenido | Out-File (Join-Path $salida $nombre) -Encoding utf8
}

# --- 1 · Que version corre y como se ve a si misma ---------------------------
$info = @()
$exe = Join-Path $env:LOCALAPPDATA "MotRest\motrest.exe"
if (Test-Path $exe) { $info += "MotRest instalado : " + (Get-Item $exe).VersionInfo.ProductVersion }
$hub = Join-Path $env:LOCALAPPDATA "MotRest\motrest-hub.exe"
if (Test-Path $hub) { $info += "Hub  fecha        : " + (Get-Item $hub).LastWriteTime }
$p = Get-Process -Name motrest-hub -ErrorAction SilentlyContinue
$info += "Hub corriendo     : " + $(if ($p) { "si, PID " + $p.Id } else { "NO" })
$suc = Join-Path $datos "sucursal.txt"
if (Test-Path $suc) { $info += "sucursal.txt      : '" + (Get-Content $suc -Raw).Trim() + "'" }
Escribir "1-version.txt" ($info -join "`r`n")

# --- 2 · Salud del Hub -------------------------------------------------------
try {
  $salud = Invoke-RestMethod "http://localhost:8788/salud" -TimeoutSec 5
  Escribir "2-salud.json" ($salud | ConvertTo-Json -Depth 6)
} catch {
  Escribir "2-salud.json" ("No contesto /salud: " + $_.Exception.Message)
}

# --- 3 · La sucursal que anuncia el POS que sirve el Hub ---------------------
# Es la mitad del posible desajuste: el Hub tiene una en sucursal.txt y el POS
# sella sus eventos con la que le llego en el enlace de emparejamiento.
try {
  $html = (Invoke-WebRequest "http://localhost:8788/" -TimeoutSec 5 -UseBasicParsing).Content
  $m = [regex]::Match($html, 'window\.__MOTREST_HUB__\s*=\s*(\{.*?\});', 'Singleline')
  if ($m.Success) {
    # Se tacha la clave del local antes de guardar nada.
    $json = $m.Groups[1].Value -replace '("clave"\s*:\s*")[^"]*', '$1————'
    Escribir "3-lo-que-ve-el-pos.json" $json
  } else { Escribir "3-lo-que-ve-el-pos.json" "El Hub no inyecto sus datos" }
} catch {
  Escribir "3-lo-que-ve-el-pos.json" ("No se pudo leer: " + $_.Exception.Message)
}

# --- 4 · La bitacora: avisos y errores, que es donde esta el motivo ----------
$registro = Join-Path $datos "registro"
if (Test-Path $registro) {
  Get-ChildItem $registro -File | Sort-Object LastWriteTime -Descending |
    Select-Object -First 3 |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $salida ("4-registro-" + $_.Name)) }
} else {
  Escribir "4-registro-VACIO.txt" "No existe $registro"
}

# --- 5 · Una COPIA de la base, para leerla fuera ------------------------------
# No se consulta aqui: la caja de un restaurante no tiene node instalado, y la
# unica copia de node que hay dentro es el propio Hub empaquetado, que solo sabe
# ejecutarse a si mismo. Se copia y se lee en la maquina de MOTRAE.
#
# Lleva la operacion del local. Es dato del cliente: no dejar esta carpeta en
# una USB que ande suelta.
$sqlite = Join-Path $datos "hub.sqlite"
if (Test-Path $sqlite) {
  foreach ($sufijo in @("", "-wal", "-shm")) {
    $origen = $sqlite + $sufijo
    # El -wal importa: lo ultimo que se escribio puede vivir solo ahi, y sin el
    # la copia no muestra precisamente el alta que se acaba de intentar.
    if (Test-Path $origen) {
      Copy-Item $origen (Join-Path $salida ("5-hub.sqlite" + $sufijo)) -ErrorAction SilentlyContinue
    }
  }
  if (-not (Test-Path (Join-Path $salida "5-hub.sqlite"))) {
    Escribir "5-hub-NO-SE-PUDO-COPIAR.txt" "La base esta en uso. Cierre MotRest y vuelva a correr esto."
  }
} else {
  Escribir "5-hub-NO-EXISTE.txt" "No existe $sqlite"
}

# --- 6 · Red: lo que impide que la tablet llegue -----------------------------
$red = @()
$red += "--- perfil de red ---"
$red += (Get-NetConnectionProfile | Select-Object Name, NetworkCategory | Out-String)
$red += "--- direcciones IPv4 ---"
$red += (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } |
         Select-Object IPAddress, InterfaceAlias | Out-String)
$red += "--- reglas de firewall de MotRest ---"
$reglas = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'MotRest|motrest-hub' }
$red += $(if ($reglas) { ($reglas | Select-Object DisplayName, Direction, Action, Enabled, Profile | Out-String) } else { "NINGUNA" })
$red += "--- escuchando ---"
$red += (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
         Where-Object { $_.LocalPort -in 8787, 8788 } |
         Select-Object LocalAddress, LocalPort | Out-String)
Escribir "6-red.txt" ($red -join "`r`n")

Write-Host ""
Write-Host "Listo. Todo esta en:" -ForegroundColor Green
Write-Host "  $salida"
Write-Host ""
Write-Host "Copie esa carpeta a la USB y llevesela." -ForegroundColor Yellow
