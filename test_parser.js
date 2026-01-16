// Тестовий скрипт для перевірки парсингу
import { initBrowser, closeBrowser } from './src/services/browser.js';
import { parseProductOptions } from './src/services/zaraParser.js';

async function test() {
    try {
        console.log("Запуск тесту...");
        await initBrowser();
        
        // Використовуємо поточний URL з браузера, оскільки ми перейшли на товар
        // Або можна жорстко задати, якщо ми знаємо його
        const url = 'https://www.zara.com/ua/uk/dvobortne-palto-zi-zmishanoi-vovnianoi-tkanyny-p08473396.html?v1=427025686'; 
        
        console.log(`Парсинг URL: ${url}`);
        const result = await parseProductOptions(url);
        
        console.log("Результат парсингу:");
        console.log(JSON.stringify(result, null, 2));
        
    } catch (e) {
        console.error("Помилка тесту:", e);
    } finally {
        await closeBrowser();
    }
}

test();
