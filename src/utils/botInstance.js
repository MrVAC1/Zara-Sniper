// Глобальний екземпляр бота для використання в інших модулях
let botInstance = null;

export function setBotInstance(bot) {
  botInstance = bot;
}

export function getBotInstance() {
  return botInstance;
}

