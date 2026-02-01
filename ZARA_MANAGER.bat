@echo off
:: Перемикаємо консоль у режим UTF-8 для коректної української мови
chcp 65001 >nul
title KBM Logic: Zara Sniper Manager v7.0 (Internal)
color 0b

:: ШЛЯХ ДО ПАПКИ (Поточна папка)
set "BOT_DIR=%~dp0"
:: Removing trailing backslash if present
if "%BOT_DIR:~-1%"=="\" set "BOT_DIR=%BOT_DIR:~0,-1%"

:: Тимчасові значення (будуть змінені в налаштуваннях)
set "token=ВВЕДІТЬ_ТОКЕН"
set "cvv=000"
set "owner_id=1341005388"
set "debug=true"
set "headless=false"

:: Спроба завантажити існуючі налаштування
if exist "%BOT_DIR%\.env" (
    for /f "tokens=1* delims==" %%A in ('type "%BOT_DIR%\.env" ^| findstr /B "BOT_TOKEN CARD_CVV OWNER_ID DEBUG_API HEADLESS"') do (
        if "%%A"=="BOT_TOKEN" set "token=%%B"
        if "%%A"=="CARD_CVV" set "cvv=%%B"
        if "%%A"=="OWNER_ID" set "owner_id=%%B"
        if "%%A"=="DEBUG_API" set "debug=%%B"
        if "%%A"=="HEADLESS" set "headless=%%B"
    )
)

:MENU
cls
echo ======================================================
echo           ZARA SNIPER BOT: ПАНЕЛЬ КЕРУВАННЯ
echo ======================================================
echo  1. ПЕРВИННЕ НАЛАШТУВАННЯ / ВІДНОВЛЕННЯ (npm install)
echo  2. ОНОВИТИ КОМПОНЕНТИ (Git Pull)
echo  3. ЗАПУСТИТИ БОТА (START)
echo  4. ЗУПИНИТИ БОТА (STOP)
echo  5. КОНФІГУРАЦІЯ ТА НАЛАШТУВАННЯ
echo  6. Вихід
echo ======================================================
set /p choice="Оберіть варіант (1-6): "

if "%choice%"=="1" goto INSTALL
if "%choice%"=="2" goto UPDATE
if "%choice%"=="3" goto START
if "%choice%"=="4" goto STOP
if "%choice%"=="5" goto SETTINGS
if "%choice%"=="6" exit
goto MENU

:INSTALL
cls
echo [INFO] Перевірка компонентів...
cd /d "%BOT_DIR%"
echo [INFO] Встановлення бібліотек (npm install)...
if exist package-lock.json del package-lock.json
call npm install --quiet
echo [INFO] Налаштування браузера (playwright)...
call npx playwright install chromium >nul 2>&1
goto INSTRUCTIONS

:INSTRUCTIONS
cls
color 0a
echo ======================================================
echo    🎉 НАЛАШТУВАННЯ ЗАВЕРШЕНО УСПІШНО! 🎉
echo ======================================================
echo ІНСТРУКЦІЯ ДЛЯ КОРИСТУВАЧА:
echo.
echo 1. Зайдіть в "НАЛАШТУВАННЯ" (Пункт 5) та перевірте ваші дані.
echo.
echo 2. ЗАПУСТІТЬ БОТА (Пункт 3).
echo.
echo ======================================================
color 0b
pause
goto MENU

:SETTINGS
cls
cd /d "%BOT_DIR%"

:: ПЕРЕВІРКА НА ПЕРШИЙ ЗАПУСК
if not exist ".env" (
    cls
    echo [INFO] Виявлено перший запуск.
    echo Потрібно ввести всі дані для створення конфігурації.
    pause
    goto SET_FULL_RESET
)

:SETTINGS_MENU
cls
echo ======================================================
echo              КОНФІГУРАЦІЯ (Settings)
echo ======================================================
echo  1. ОСНОВНІ: Швидкість та Логи
echo  2. БРАУЗЕР: Режим відображення
echo  3. ЗВ'ЯЗОК: Telegram Token
echo  4. ОПЛАТА: CARD_CVV
echo  5. КОРИСТУВАЧ: Телеграм ID (%owner_id%)
echo  6. ПОВНИЙ СКИД (Ввести все вручну)
echo  7. НАЗАД ДО МЕНЮ
echo ======================================================
set /p set_choice="Виберіть пункт (1-7): "

if "%set_choice%"=="1" goto SET_GENERAL
if "%set_choice%"=="2" goto SET_BROWSER
if "%set_choice%"=="3" goto SET_TELEGRAM
if "%set_choice%"=="4" goto SET_PAYMENT
if "%set_choice%"=="5" goto SET_OWNER
if "%set_choice%"=="6" goto SET_FULL_RESET
if "%set_choice%"=="7" goto MENU
goto SETTINGS_MENU

:SET_GENERAL
cls
set /p debug="Показувати технічні логи? (true/false): "
goto SAVE_CONFIG

:SET_BROWSER
cls
set /p headless="Приховати вікно браузера? (true/false): "
goto SAVE_CONFIG

:SET_TELEGRAM
cls
set /p token="Введіть новий Telegram BOT_TOKEN: "
goto SAVE_CONFIG

:SET_PAYMENT
cls
set /p cvv="Введіть новий CARD_CVV (3 цифри): "
goto SAVE_CONFIG

:SET_OWNER
cls
set /p owner_id="Введіть ваш Telegram ID: "
goto SAVE_CONFIG

:SET_FULL_RESET
cls
echo [НАЛАШТУВАННЯ ВСІХ ДАНИХ]
echo ------------------------------------------------------
set /p token="1. Введіть Telegram BOT_TOKEN: "
set /p cvv="2. Введіть ваші 3 цифри CVV: "
set /p debug="3. Debug-режим (true - показувати логи): "
set /p headless="4. Приховати браузер? (true/false): "
set /p owner_id="5. Введіть ваш Telegram ID: "
goto SAVE_CONFIG

:SAVE_CONFIG
(
echo # --- User Input ---
echo BOT_TOKEN=%token%
echo CARD_CVV=%cvv%
echo DEBUG_API=%debug%
echo HEADLESS=%headless%
echo API_MONITORING_INTERVAL=500
echo AKAMAI_BAN_DELAY=45000
echo.
echo # --- Core Bot Config ---
echo SNIPER_INTERVAL=10000
echo GOTO_TIMEOUT=10000
echo SELECTOR_TIMEOUT=10000
echo HEALTH_CHECK_INTERVAL=900000
echo.
echo # --- Human Emulation ---
echo ACTION_PAUSE=800
echo CLICK_DELAY=200
echo MIN_DELAY=000
echo MAX_DELAY=200
echo.
echo # --- Advanced Timing ---
echo TIMEOUT_SIZE_MENU=2000
echo TIMEOUT_3DS_REDIRECT=3000
echo TIMEOUT_API_RETRY=500
echo TIMEOUT_HEALTH_PAGE=60000
echo TIMEOUT_DB_RETRY=3000
echo TIMEOUT_LOOP_RETRY=3000
echo TIMEOUT_FAST_SELECTOR=1000
echo TIMEOUT_CLICK_TRIAL=500
echo IN_STOCK_RECOVERY_TIMEOUT=5000
echo TIMEOUT_SOLD_OUT_CHECK=500
echo TIMEOUT_MODAL_CHECK=500
echo TIMEOUT_PAY_BUTTON=2000
echo.
echo # --- Delays ---
echo DELAY_POST_RELOAD=500
echo DELAY_BETWEEN_CONTINUE=300
echo DELAY_POST_CVV=2000
echo DELAY_CAPTCHA_SOLVE=30000
echo DELAY_3DS_SUCCESS=2500
echo DELAY_WATCH_LOOP=300
echo DELAY_CHECKOUT_STEP=200
echo DELAY_FAST_BACKTRACK=200
echo DELAY_FAST_RECOVERY=2000
echo DELAY_RECOVERY_WATCHDOG=8000
echo.
echo # --- System ---
echo LOG_LEVEL=info
echo ENABLE_SCREENSHOTS=true
echo OWNER_ID=%owner_id%
echo MONGODB_URI=mongodb+srv://maksrust1_db_user:PqyVXK2V02wYzOAa@cluster0.tuubcxd.mongodb.net/?appName=Cluster0
) > .env
echo [SUCCESS] Дані збережено в .env!
pause
goto SETTINGS_MENU

:UPDATE
cls
cd /d "%BOT_DIR%"
echo [INFO] Оновлення з GitHub...
git pull
if exist package-lock.json del package-lock.json
call npm install
echo [SUCCESS] Оновлено.
pause
goto MENU

:START
cls
cd /d "%BOT_DIR%"
start "ZARA_RUN" npm run start
goto MENU

:STOP
cls
cd /d "%BOT_DIR%"
echo [INFO] Reading configuration...

:: 1. Read OWNER_ID from .env for PID lookup
for /f "tokens=1* delims==" %%a in (.env) do (
    if "%%a"=="OWNER_ID" set "env_owner_id=%%b"
)

:: 2. Extract first ID (before comma)
for /f "tokens=1 delims=," %%a in ("%env_owner_id%") do set "primary_owner=%%a"
:: Sanitize (simple pass, assume numeric/clean)
set "primary_owner=%primary_owner: =%"

set "pid_file=.pid_%primary_owner%"

if exist "%pid_file%" (
    set /p bot_pid=<"%pid_file%"
    echo [INFO] Found PID file. Stopping PID: %bot_pid%...
    taskkill /PID %bot_pid% /F /T >nul 2>&1
    :: Wait a bit and clean up if still there (JS should auto-clean but force kill might prevent it)
    timeout /t 1 >nul
    if exist "%pid_file%" del "%pid_file%"
    echo [SUCCESS] Bot process killed.
) else (
    echo [WARN] PID file not found (%pid_file%).
    echo [INFO] Trying legacy stop (Process Name)...
    taskkill /FI "WINDOWTITLE eq ZARA_RUN*" /F /T >nul 2>&1
    echo [SUCCESS] Legacy stop command sent.
)
pause
goto MENU