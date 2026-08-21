# ---------------------------------------------------------------------------
#  Reabrir el acceso de soporte a la caja de Rodizio (equipo GONZALITO)
#
#  Ejecutar EN LA CAJA, en PowerShell COMO ADMINISTRADOR.
#  (Clic derecho en Inicio -> "Terminal (Administrador)")
#
#  Se puede hacer por AnyDesk; no hace falta estar en el restaurante.
#  Al terminar imprime un resumen: mandar esa salida a Gonzalo.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
Write-Host "`n=== MotRest - acceso de soporte ===`n" -ForegroundColor Cyan

# --- 1. sshd instalado y encendido -----------------------------------------
$svc = Get-Service sshd -ErrorAction SilentlyContinue
if (-not $svc) {
  Write-Host "sshd NO esta instalado. Instalando..." -ForegroundColor Yellow
  try {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction Stop | Out-Null
    Write-Host "  instalado." -ForegroundColor Green
  } catch {
    Write-Host "  FALLO. Windows Update esta bloqueado por directiva." -ForegroundColor Red
    Write-Host "  Salida: bajar el MSI de PowerShell/Win32-OpenSSH en GitHub y:" -ForegroundColor Red
    Write-Host '    msiexec /i OpenSSH-Win64-v9.x.msi ADDLOCAL=Server /qn' -ForegroundColor Red
    exit 1
  }
  $svc = Get-Service sshd
}
Set-Service sshd -StartupType Automatic
if ($svc.Status -ne 'Running') { Start-Service sshd }
Write-Host ("sshd: {0}" -f (Get-Service sshd).Status) -ForegroundColor Green

# --- 2. La llave publica de soporte ----------------------------------------
#
# Para una cuenta de ADMINISTRADOR, Windows IGNORA ~/.ssh/authorized_keys y solo
# mira este archivo. Ademas exige ACL estricta o lo descarta SIN AVISAR.
$llave = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII+hfYxYKnKWrFM0hImIMoAyDD71smxrArV/+Hm9UTyQ claude-soporte-motrae'
$ruta  = 'C:\ProgramData\ssh\administrators_authorized_keys'

New-Item -ItemType Directory -Force -Path 'C:\ProgramData\ssh' | Out-Null
# -Encoding ascii a proposito: el utf8 de PowerShell 5.1 mete BOM y sshd
# descarta el archivo en silencio.
Set-Content -Path $ruta -Value $llave -Encoding ascii

# La ACL va por SID, NO por nombre: en Windows en espanol el grupo se llama
# "Administradores" y `icacls Administrators:F` no encuentra nada.
icacls $ruta /inheritance:r          | Out-Null
icacls $ruta /grant '*S-1-5-32-544:F' | Out-Null   # Administradores
icacls $ruta /grant '*S-1-5-18:F'     | Out-Null   # SYSTEM
Write-Host "llave de soporte: instalada" -ForegroundColor Green

# --- 3. Firewall: 22 y 8787 en TODOS los perfiles --------------------------
#
# La red del local cambio y Windows la clasifico como "Publica", que bloquea
# todo lo entrante. Sin esto la maquina responde al ping y nada mas.
foreach ($r in @(
    @{ n = 'MotRest soporte SSH'; p = 22 },
    @{ n = 'MotRest Hub';         p = 8787 }
  )) {
  Get-NetFirewallRule -DisplayName $r.n -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $r.n -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $r.p -Profile Any | Out-Null
  Write-Host ("firewall: {0} (puerto {1}) permitido" -f $r.n, $r.p) -ForegroundColor Green
}

# --- 4. Estado del propio MotRest ------------------------------------------
$procs = Get-Process -Name 'motrest*' -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host "`nMotRest corriendo:" -ForegroundColor Green
  $procs | Select-Object Id, ProcessName, StartTime | Format-Table -AutoSize
} else {
  Write-Host "`nAVISO: MotRest NO esta corriendo. Abrelo antes de avisar." -ForegroundColor Yellow
}

# --- 5. Resumen para mandar ------------------------------------------------
Write-Host "`n=== MANDAR ESTO A GONZALO ===" -ForegroundColor Cyan
"Equipo   : $env:COMPUTERNAME"
"Usuario  : $env:USERNAME"
"sshd     : " + (Get-Service sshd).Status
"Version  : " + (Get-Item 'C:\Users\ironm\AppData\Local\MotRest\motrest.exe' -ErrorAction SilentlyContinue).VersionInfo.FileVersion
"Red      : " + (Get-NetConnectionProfile | Select-Object -First 1 -ExpandProperty Name)
"IPs      :"
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
  ForEach-Object { "           " + $_.IPAddress + "  (" + $_.InterfaceAlias + ")" }
Write-Host "`nListo.`n" -ForegroundColor Cyan
