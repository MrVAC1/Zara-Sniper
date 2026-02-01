import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zara_sniper';

export async function connectDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Підключено до MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('❌ Помилка підключення до MongoDB:', error);
    throw error;
  }
}

export async function disconnectDatabase() {
  try {
    await mongoose.disconnect();
    console.log('🔌 Відключено від MongoDB');
  } catch (error) {
    console.error('❌ Помилка відключення від MongoDB:', error);
  }
}

