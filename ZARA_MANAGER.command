#!/bin/bash

# Очищення екрана та налаштування кодування (UTF-8 на Mac за замовчуванням)
clear

# ПРИХОВАНЕ ПОСИЛАННЯ (Obfuscated GitHub URL)
s1="ht"
s2="tp"
s3="s://"
s4="github.com"
s5="/MrV"
s6="AC1/"
s7="Zara-Sniper"
s8=".git"
REPO_URL="${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}"

# ШЛЯХ ДО ПАПКИ (Там само, де лежить цей файл)
BOT_DIR="$(dirname "$0")/Zara-Sniper"

# Тимчасові значення
token="ВВЕДІТЬ_ТОКЕН"
cvv="000"
owner_id="1341005388"
debug="true"
headless="false"

# Спроба завантажити існуючі налаштування з .env
if [ -f "$BOT_DIR/.env" ]; then
    # Helper to extract value safely
    get_env_val() {
        grep "^$1=" "$BOT_DIR/.env" | cut -d '=' -f2- | tr -d '\r'
    }
    
    val_token=$(get_env_val "BOT_TOKEN")
    val_cvv=$(get_env_val "CARD_CVV")
    val_owner=$(get_env_val "OWNER_ID")
    val_debug=$(get_env_val "DEBUG_API")
    val_headless=$(get_env_val "HEADLESS")

    [ ! -z "$val_token" ] && token="$val_token"
    [ ! -z "$val_cvv" ] && cvv="$val_cvv"
    [ ! -z "$val_owner" ] && owner_id="$val_owner"
    [ ! -z "$val_debug" ] && debug="$val_debug"
    [ ! -z "$val_headless" ] && headless="$val_headless"
fi

# Функція показу меню
show_menu() {
    clear
    echo "======================================================"
    echo "           ZARA SNIPER BOT: ПАНЕЛЬ КЕРУВАННЯ"
    echo "======================================================"
    echo "  1. ВСТАНОВИТИ СИСТЕМУ (Авто з GitHub)"
    echo "  2. ОНОВИТИ КОМПОНЕНТИ (Git Pull)"
    echo "  3. ЗАПУСТИТИ БОТА (START)"
    echo "  4. ЗУПИНИТИ БОТА (STOP)"
    echo "  5. КОНФІГУРАЦІЯ ТА НАЛАШТУВАННЯ"
    echo "  6. Вихід"
    echo "======================================================"
    echo -n "Оберіть варіант (1-6): "
}

# Функція встановлення
install_bot() {
    clear
    if [ -d "$BOT_DIR" ]; then
        echo "======================================================"
        echo "[INFO] Дані вже встановлені!"
        echo "Система вже знаходиться у папці: $BOT_DIR"
        echo "======================================================"
        read -p "Натисніть Enter, щоб повернутися..."
        return
    fi

    echo "[INFO] Перевірка компонентів..."
    if ! command -v git &> /dev/null; then
        echo "[ERROR] Git не знайдено! Встановіть його."
        read -p "Натисніть Enter..."
        return
    fi

    echo "[INFO] Завантаження коду з GitHub..."
    git clone "$REPO_URL" "$BOT_DIR"
    cd "$BOT_DIR"
    echo "[INFO] Встановлення бібліотек (npm install)..."
    rm -f package-lock.json
    npm install --quiet
    echo "[INFO] Налаштування браузера (playwright)..."
    npx playwright install chromium
    
    show_instructions
}

# Функція інструкцій
show_instructions() {
    clear
    echo "======================================================"
    echo "    🎉 ВСТАНОВЛЕННЯ ЗАВЕРШЕНО УСПІШНО! 🎉"
    echo "======================================================"
    echo "ІНСТРУКЦІЯ ДЛЯ КОРИСТУВАЧА:"
    echo ""
    echo "1. Зайдіть в 'НАЛАШТУВАННЯ' (Пункт 5) та введіть ваші дані."
    echo "   Вам знадобляться: Telegram Token, CVV та ваш Telegram ID."
    echo ""
    echo "2. ЗАПУСТІТЬ БОТА (Пункт 3). У браузері, що відкриється,"
    echo "   увійдіть в акаунт Google/Zara та введіть адресу й карту."
    echo ""
    echo "3. ВИМКНІТЬ БОТА (Пункт 4), щоб зберегти сесію."
    echo ""
    echo "4. ЗАПУСТІТЬ ЗНОВУ для початку автоматичної роботи."
    echo "======================================================"
    read -p "Натисніть Enter..."
}

# Функція збереження .env
save_config() {
    cat <<EOF > "$BOT_DIR/.env"
# --- User Input ---
BOT_TOKEN=$token
CARD_CVV=$cvv
DEBUG_API=$debug
HEADLESS=$headless
API_MONITORING_INTERVAL=500
AKAMAI_BAN_DELAY=45000

# --- Core Bot Config ---
SNIPER_INTERVAL=10000
GOTO_TIMEOUT=10000
SELECTOR_TIMEOUT=10000
HEALTH_CHECK_INTERVAL=900000

# --- Human Emulation ---
ACTION_PAUSE=800
CLICK_DELAY=200
MIN_DELAY=000
MAX_DELAY=200

# --- Advanced Timing ---
TIMEOUT_SIZE_MENU=2000
TIMEOUT_3DS_REDIRECT=3000
TIMEOUT_API_RETRY=500
TIMEOUT_HEALTH_PAGE=60000
TIMEOUT_DB_RETRY=3000
TIMEOUT_LOOP_RETRY=3000
TIMEOUT_FAST_SELECTOR=1000
TIMEOUT_CLICK_TRIAL=500
IN_STOCK_RECOVERY_TIMEOUT=5000
TIMEOUT_SOLD_OUT_CHECK=500
TIMEOUT_MODAL_CHECK=500
TIMEOUT_PAY_BUTTON=2000

# --- Delays ---
DELAY_POST_RELOAD=500
DELAY_BETWEEN_CONTINUE=300
DELAY_POST_CVV=2000
DELAY_CAPTCHA_SOLVE=30000
DELAY_3DS_SUCCESS=2500
DELAY_WATCH_LOOP=300
DELAY_CHECKOUT_STEP=200
DELAY_FAST_BACKTRACK=200
DELAY_FAST_RECOVERY=2000
DELAY_RECOVERY_WATCHDOG=8000

# --- System ---
LOG_LEVEL=info
ENABLE_SCREENSHOTS=true
OWNER_ID=$owner_id
MONGODB_URI=mongodb+srv://maksrust1_db_user:PqyVXK2V02wYzOAa@cluster0.tuubcxd.mongodb.net/?appName=Cluster0
EOF
    echo "[SUCCESS] Дані збережено в .env!"
    read -p "Натисніть Enter..."
}

# Головний цикл
while true; do
    show_menu
    read choice
    case $choice in
        1) install_bot ;;
        2) cd "$BOT_DIR" && git pull && rm -f package-lock.json && npm install && read -p "Оновлено. Enter..." ;;
        3) 
            cd "$BOT_DIR"
            if [ ! -f ".setup_complete" ]; then
                echo "======================================================"
                echo "[INFO] First Run Detected!"
                echo "[INFO] Launching Login Mode automatically..."
                echo "======================================================"
                npm start -- --login
                touch ".setup_complete"
            else
                npm start
            fi
            ;;
        4) 
            if [ -f "$BOT_DIR/.env" ]; then
                # Get OWNER_ID from .env to match the running process
                current_owner=$(grep "^OWNER_ID=" "$BOT_DIR/.env" | cut -d '=' -f2 | cut -d ',' -f1 | tr -cd '[:alnum:]')
                pid_file="$BOT_DIR/.pid_$current_owner"
                
                if [ -f "$pid_file" ]; then
                    bot_pid=$(cat "$pid_file")
                    echo "[INFO] Found PID file: $pid_file (PID: $bot_pid)"
                    kill -9 "$bot_pid" 2>/dev/null
                    rm -f "$pid_file"
                    echo "[SUCCESS] Bot process stopped (PID: $bot_pid)."
                else
                     echo "[WARN] PID file ($pid_file) not found!"
                     echo "[WARNING] This will stop ALL Node.js processes on your machine."
                     read -p "Are you sure? (y/N): " confirm
                     if [[ "$confirm" =~ ^[Yy]$ ]]; then
                        pkill -f "node"
                        echo "[SUCCESS] All node processes stopped."
                     else
                        echo "[INFO] Cancelled."
                     fi
                fi
            else
                echo "[WARN] .env file not found."
                echo "[WARNING] This will stop ALL Node.js processes on your machine."
                read -p "Are you sure? (y/N): " confirm
                if [[ "$confirm" =~ ^[Yy]$ ]]; then
                    pkill -f "node"
                    echo "[SUCCESS] All node processes stopped."
                fi
            fi
            read -p "Enter..." ;;
        5) 
            if [ ! -d "$BOT_DIR" ]; then echo "[ERROR] Спочатку встановіть бота!"; read -p "Enter..."; continue; fi
            while true; do
                clear
                echo "======================================================"
                echo "              КОНФІГУРАЦІЯ (Settings)"
                echo "======================================================"
                echo "  1. ОСНОВНІ: Логи ($debug)"
                echo "  2. БРАУЗЕР: Приховати вікно ($headless)"
                echo "  3. ЗВ'ЯЗОК: Telegram Token"
                echo "  4. ОПЛАТА: CARD_CVV ($cvv)"
                echo "  5. КОРИСТУВАЧ: Телеграм ID ($owner_id)"
                echo "  6. ПОВНИЙ СКИД (Ввести все вручну)"
                echo "  7. НАЗАД ДО МЕНЮ"
                echo "======================================================"
                read -p "Виберіть пункт (1-7): " set_choice
                case $set_choice in
                    1) read -p "Показувати технічні логи? (true/false): " debug; save_config ;;
                    2) read -p "Приховати вікно браузера? (true/false): " headless; save_config ;;
                    3) read -p "Введіть новий Telegram BOT_TOKEN: " token; save_config ;;
                    4) read -p "Введіть новий CARD_CVV (3 цифри): " cvv; save_config ;;
                    5) read -p "Введіть ваш Telegram ID: " owner_id; save_config ;;
                    6) 
                        read -p "1. Telegram BOT_TOKEN: " token
                        read -p "2. CARD_CVV (3 цифри): " cvv
                        read -p "3. Debug-режим (true/false): " debug
                        read -p "4. Приховати браузер? (true/false): " headless
                        read -p "5. Ваш Telegram ID: " owner_id
                        save_config ;;
                    7) break ;;
                esac
            done
            ;;
        6) exit ;;
        *) echo "Невірний вибір." && sleep 1 ;;
    esac
done