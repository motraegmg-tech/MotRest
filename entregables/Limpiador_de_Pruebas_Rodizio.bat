@echo off
echo =======================================================
echo    LIMPIADOR DE DATOS DE PRUEBA - MOTREST (RODIZIO)
echo =======================================================
echo.
echo Este script borrara cualquier dato de prueba viejo guardado en
echo esta computadora (como el usuario de Gonzalo) para que la
echo instalacion nueva quede 100%% limpia.
echo.
echo ADVERTENCIA: Solo usar ANTES de instalar por primera vez o
echo si se desea reiniciar el sistema desde cero.
echo.
pause

echo.
echo Cerrando MotRest si esta abierto...
taskkill /IM motrest.exe /F 2>nul
taskkill /IM motrest-hub-x86_64-pc-windows-msvc.exe /F 2>nul

echo.
echo Borrando datos de prueba locales...
rmdir /s /q "%LOCALAPPDATA%\mx.motrae.motrest" 2>nul
rmdir /s /q "%APPDATA%\mx.motrae.motrest" 2>nul

echo.
echo ¡Listo! La computadora esta limpia. 
echo Ya puedes ejecutar el instalador MotRest-1.1.1-Rodizio.exe.
echo.
pause
