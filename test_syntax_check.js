
import { closeAlerts } from './src/services/browser.js';
import { checkSkuAvailability } from './src/services/sniperEngine.js';
import { handleProductUrl } from './src/handlers/productHandler.js';
import SniperTask from './src/models/SniperTask.js';

console.log('Modules imported successfully. Syntax seems OK.');
console.log('CloseAlerts is function:', typeof closeAlerts === 'function');
console.log('CheckSkuAvailability is function:', typeof checkSkuAvailability === 'function');
console.log('HandleProductUrl is function:', typeof handleProductUrl === 'function');
console.log('SniperTask model loaded:', !!SniperTask);
