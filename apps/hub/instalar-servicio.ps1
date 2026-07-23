<#
.SINOPSIS
    Deja el Hub de MotRest arrancando solo con la computadora de la caja.

.DESCRIPCION
    Registra una tarea programada que levanta el Hub al encender el equipo,
    antes incluso de que alguien inicie sesión en Windows. Es lo que hace que
    el restaurante pueda abrir sin que nadie tenga que acordarse de arrancar
    nada.

    POR QUÉ UNA TAREA PROGRAMADA Y NO UN SERVICIO
    Un servicio de Windows exige un ejecutable que hable el protocolo de
    servicios, lo que obliga a un envoltorio nativo. Una tarea programada
    "al iniciar el sistema" consigue lo mismo —arranca sin sesión, se reinicia
    si falla— sin agregar una pieza más que mantener. Cuando llegue el
    instalador nativo (Tauri), ese sí registrará un servicio propiamente dicho.

.NOTAS
    Requiere PowerShell COMO ADMINISTRADOR: registrar una tarea que corre sin
    sesión iniciada es una operación privilegiada, y con razón.

.EJEMPLO
    .\instalar-servicio.ps1
    .\instalar-servicio.ps1 -Desinstalar
#>

param(
    [switch]$Desinstalar,
    [string]$Nombre = "MotRest Hub"
)

$ErrorActionPreference = "Stop"

# --- Comprobaciones antes de tocar nada ------------------------------------------

$esAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $esAdmin) {
    Write-Host "Hace falta PowerShell como administrador." -ForegroundColor Red
    Write-Host "Clic derecho en PowerShell -> 'Ejecutar como administrador', y vuelve a intentarlo."
    exit 1
}

if ($Desinstalar) {
    if (Get-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false
        Write-Host "Listo: '$Nombre' ya no arranca con el equipo." -ForegroundColor Green
    } else {
        Write-Host "No estaba instalado; no hay nada que quitar."
    }
    exit 0
}

$carpetaHub = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "No se encontró Node.js en este equipo." -ForegroundColor Red
    Write-Host "Instálalo desde https://nodejs.org y vuelve a ejecutar este script."
    exit 1
}

# El POS compilado es lo que el Hub sirve a las terminales. Sin él arranca, pero
# no habría punto de venta que abrir: mejor avisar ahora que descubrirlo el
# viernes.
$posCompilado = Join-Path $carpetaHub "..\pos-ui\dist\index.html"
if (-not (Test-Path $posCompilado)) {
    Write-Host "AVISO: el POS no está compilado." -ForegroundColor Yellow
    Write-Host "  Ejecuta antes:  corepack pnpm@9.15.0 --filter pos-ui build"
    Write-Host ""
}

# --- Registro de la tarea ---------------------------------------------------------

$arranque = Join-Path $carpetaHub "arrancar.cmd"

# tsx es quien ejecuta el TypeScript del Hub. `node --experimental-strip-types`
# NO sirve aquí: no reescribe las extensiones .js de los imports internos y el
# arranque falla con "Cannot find module".
$tsx = Join-Path $carpetaHub "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $tsx)) {
    Write-Host "Faltan las dependencias del Hub." -ForegroundColor Red
    Write-Host "  Ejecuta antes:  corepack pnpm@9.15.0 install"
    exit 1
}

@"
@echo off
rem Arranque del Hub de MotRest. Lo genera instalar-servicio.ps1; no editar a mano.
cd /d "%~dp0"
call "$tsx" "%~dp0src\main.ts"
"@ | Set-Content -Path $arranque -Encoding utf8

$accion = New-ScheduledTaskAction -Execute $arranque -WorkingDirectory $carpetaHub
$disparador = New-ScheduledTaskTrigger -AtStartup

# SYSTEM para que arranque sin que nadie inicie sesión en Windows: la caja debe
# estar lista en cuanto la computadora enciende.
$identidad = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount `
    -RunLevel Highest

# Que se reinicie solo si se cae, y sin límite de tiempo de ejecución: es un
# servicio que debe estar vivo todo el turno.
$opciones = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -StartWhenAvailable

if (Get-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false
}

Register-ScheduledTask -TaskName $Nombre -Action $accion -Trigger $disparador `
    -Principal $identidad -Settings $opciones `
    -Description "Hub de MotRest: registro de ventas del local y sincronizacion entre terminales." | Out-Null

Write-Host ""
Write-Host "Listo. El Hub arrancará solo con el equipo." -ForegroundColor Green
Write-Host ""
Write-Host "  Arrancarlo ahora sin reiniciar:   Start-ScheduledTask -TaskName '$Nombre'"
Write-Host "  Ver si está corriendo:            Get-ScheduledTask -TaskName '$Nombre'"
Write-Host "  Quitarlo:                         .\instalar-servicio.ps1 -Desinstalar"
Write-Host ""
Write-Host "PENDIENTE: abrir el puerto 8787 en el firewall de Windows para que las" -ForegroundColor Yellow
Write-Host "terminales de la red alcancen el Hub:" -ForegroundColor Yellow
Write-Host "  New-NetFirewallRule -DisplayName 'MotRest Hub' -Direction Inbound ``"
Write-Host "    -LocalPort 8787 -Protocol TCP -Action Allow"
Write-Host ""
