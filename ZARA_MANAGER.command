#!/bin/bash

# Переходимо в папку скрипта
cd "$(dirname "$0")"
clear

# --- Кольори ---
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -n -e "\033]0;KBM Logic: Zara Sniper Manager v6.4\007"

# --- ПРИХОВАНЕ ПОСИЛАННЯ ---
s1="ht"
s2="tp"
s3="s://"
s4="github.com"
s5="/MrV"
s6="AC1/"
s7="Zara-Sniper"
s8=".git"
REPO_URL="${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}"

# --- ШЛЯХ ДО ПАПКИ ---
BOT_DIR="$(pwd)/Zara-Sniper"

# --- Значення за замовчуванням (для пам'яті) ---
BOT_TOKEN="ВВЕДІТЬ_ТОКЕН"
CARD_CVV="000"
API_MONITORING_INTERVAL="500"
DEBUG_API="true"
HEADLESS="false"

# --- Функція для запису .env ---
save_env() {
cat > .env <<EOF
# --- User Input ---
BOT_TOKEN=$BOT_TOKEN
CARD_CVV=$CARD_CVV
DEBUG_API=$DEBUG_API
HEADLESS=$HEADLESS
API_MONITORING_INTERVAL=$API_MONITORING_INTERVAL
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
OWNER_ID=1341005388,360527303
MONGODB_URI=mongodb+srv://maksrust1_db_user:PqyVXK2V02wYzOAa@cluster0.tuubcxd.mongodb.net/?appName=Cluster0
EOF
echo -e "${GREEN}[SUCCESS] Дані збережено в .env!${NC}"
read -p "Натисніть Enter..."
}

show_menu() {
    clear
    echo -e "${CYAN}======================================================${NC}"
    echo -e "${CYAN}           ZARA SNIPER BOT: ПАНЕЛЬ КЕРУВАННЯ${NC}"
    echo -e "${CYAN}======================================================${NC}"
    echo "  1. ВСТАНОВИТИ СИСТЕМУ (Авто з GitHub)"
    echo "  2. ОНОВИТИ КОМПОНЕНТИ (Git Pull)"
    echo "  3. ЗАПУСТИТИ БОТА (START)"
    echo "  4. ЗУПИНИТИ БОТА (STOP)"
    echo "  5. КОНФІГУРАЦІЯ ТА НАЛАШТУВАННЯ"
    echo "  6. Вихід"
    echo -e "${CYAN}======================================================${NC}"
    echo -n "Оберіть варіант (1-6): "
}

while true; do
    show_menu
    read choice
    case $choice in
        1) # INSTALL
            clear
            if [ -d "$BOT_DIR" ]; then
                echo -e "${GREEN}[INFO] Дані вже встановлені!${NC}"
                read -p "Натисніть Enter..."
                continue
            fi
            echo "[INFO] Перевірка компонентів..."
            if ! command -v git &> /dev/null; then
                echo -e "${RED}[ERROR] Git не знайдено!${NC}"
                read -p "Натисніть Enter..."
                continue
            fi
            echo "[INFO] Завантаження..."
            git clone "$REPO_URL" "$BOT_DIR"
            cd "$BOT_DIR" || exit
            npm install --quiet
            npx playwright install chromium
            echo -e "${GREEN}ВСТАНОВЛЕНО УСПІШНО!${NC}"
            read -p "Натисніть Enter..."
            cd ..
            ;;
        2) # UPDATE
            clear
            cd "$BOT_DIR" || { echo "Папка не знайдена"; read; continue; }
            git pull
            npm install
            echo -e "${GREEN}[SUCCESS] Оновлено.${NC}"
            read -p "Натисніть Enter..."
            cd ..
            ;;
        3) # START
            clear
            if [ ! -d "$BOT_DIR" ]; then
                echo -e "${RED}[ERROR] Бот не встановлений!${NC}"
                read -p "Натисніть Enter..."
                continue
            fi
            echo "Запуск бота в новому вікні..."
            osascript -e "tell application \"Terminal\" to do script \"cd '$BOT_DIR' && npm run start\""
            cd ..
            ;;
        4) # STOP
            clear
            pkill -f "node.*index.js" > /dev/null 2>&1
            pkill -f "playwright" > /dev/null 2>&1
            echo -e "${GREEN}[SUCCESS] Зупинено.${NC}"
            read -p "Натисніть Enter..."
            ;;
        5) # SETTINGS
            while true; do
                clear
                if [ ! -d "$BOT_DIR" ]; then
                    echo -e "${RED}Спочатку встановіть бота!${NC}"
                    read -p "Enter..."
                    break
                fi
                cd "$BOT_DIR"

                # Завантажуємо поточні змінні, якщо файл існує
                if [ -f ".env" ]; then
                    # Простий спосіб зчитати змінні без source (щоб уникнути помилок формату)
                    # Але для простоти ми використовуємо змінні з пам'яті або перезаписуємо
                    # Тут ми просто припускаємо, що користувач хоче змінити поточні або ввести нові
                    : 
                else
                    echo "[INFO] Перший запуск. Введіть дані."
                    # Якщо файлу немає, йдемо на повне скидання
                    read -p "1. Telegram Token: " BOT_TOKEN
                    read -p "2. CVV (3 цифри): " CARD_CVV
                    read -p "3. Швидкість (500): " API_MONITORING_INTERVAL
                    read -p "4. Debug (true): " DEBUG_API
                    read -p "5. Headless (false): " HEADLESS
                    save_env
                    continue
                fi
                
                echo -e "${CYAN}======================================================${NC}"
                echo -e "${CYAN}              КОНФІГУРАЦІЯ (Settings)${NC}"
                echo -e "${CYAN}======================================================${NC}"
                echo " 1. ОСНОВНІ: Швидкість та Логи"
                echo " 2. БРАУЗЕР: Режим відображення"
                echo " 3. ЗВ'ЯЗОК: Telegram Token"
                echo " 4. ОПЛАТА: CARD_CVV"
                echo " 5. ПОВНИЙ СКИД (Ввести все вручну)"
                echo " 6. НАЗАД ДО МЕНЮ"
                echo -e "${CYAN}======================================================${NC}"
                
                read -p "Виберіть пункт (1-6): " set_choice
                
                # Завантажуємо поточний стан в змінні для редагування (якщо файл є)
                if [ -f ".env" ]; then
                    # Ми використовуємо grep для витягування значень
                    current_token=$(grep "BOT_TOKEN=" .env | cut -d '=' -f2)
                    [ ! -z "$current_token" ] && BOT_TOKEN=$current_token
                    
                    current_cvv=$(grep "CARD_CVV=" .env | cut -d '=' -f2)
                    [ ! -z "$current_cvv" ] && CARD_CVV=$current_cvv
                    
                    current_debug=$(grep "DEBUG_API=" .env | cut -d '=' -f2)
                    [ ! -z "$current_debug" ] && DEBUG_API=$current_debug
                    
                    current_headless=$(grep "HEADLESS=" .env | cut -d '=' -f2)
                    [ ! -z "$current_headless" ] && HEADLESS=$current_headless
                    
                    current_interval=$(grep "API_MONITORING_INTERVAL=" .env | cut -d '=' -f2)
                    [ ! -z "$current_interval" ] && API_MONITORING_INTERVAL=$current_interval
                fi

                case $set_choice in
                    1)
                        read -p "Показувати технічні логи? (true/false): " DEBUG_API
                        save_env
                        ;;
                    2)
                        read -p "Приховати вікно браузера? (true/false): " HEADLESS
                        save_env
                        ;;
                    3)
                        read -p "Введіть новий Telegram BOT_TOKEN: " BOT_TOKEN
                        save_env
                        ;;
                    4)
                        read -p "Введіть новий CARD_CVV (3 цифри): " CARD_CVV
                        save_env
                        ;;
                    5)
                        # Повний скид
                        echo "[ПОВНЕ НАЛАШТУВАННЯ]"
                        read -p "1. Telegram Token: " BOT_TOKEN
                        read -p "2. CVV (3 цифри): " CARD_CVV
                        read -p "3. Швидкість (мс): " API_MONITORING_INTERVAL
                        read -p "4. Debug (true/false): " DEBUG_API
                        read -p "5. Приховати браузер (true/false): " HEADLESS
                        save_env
                        ;;
                    6)
                        cd ..
                        break # Вихід в головне меню
                        ;;
                    *)
                        echo "Невірний вибір"
                        ;;
                esac
            done
            ;;
        6) exit 0 ;;
    esac
done