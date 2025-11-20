@echo off
chcp 65001 >nul
setlocal

set PORT=3000
cd /d "%~dp0"

echo ========================================
echo   Запуск сервера для АТУ портала
echo ========================================
echo.

rem === Проверяем Node.js ===
node --version >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Node.js не найден!
    echo.
    echo Установите Node.js с https://nodejs.org/
    echo.
    pause
    start "" https://nodejs.org/
    exit /b 1
)

echo [OK] Node.js найден
node --version

rem === Проверяем наличие server.js ===
if not exist "server.js" (
    echo [ОШИБКА] Файл server.js не найден!
    echo.
    pause
    exit /b 1
)

echo [OK] Файл server.js найден
echo.

rem === Запускаем сервер в отдельном окне ===
echo Запускаю сервер на порту %PORT%...
start "ATU Portal Server" cmd /k "node server.js"

rem === Ждём 4 секунды для запуска сервера ===
echo Ожидание запуска сервера...
timeout /t 4 /nobreak >nul

rem === Открываем браузер ===
echo Открываю браузер...
start "" http://localhost:%PORT%/

echo.
echo ========================================
echo   Сервер запущен!
echo   Адрес: http://localhost:%PORT%/
echo.
echo   Для остановки закройте окно сервера
echo ========================================
echo.

exit /b 0
