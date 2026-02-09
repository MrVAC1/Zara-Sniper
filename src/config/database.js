import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zara_sniper';

export async function connectDatabase(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[Database] Connecting... (Attempt ${i + 1}/${retries})`);
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 30000, // 30s timeout
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000
      });
      console.log('✅ Підключено до MongoDB');
      return mongoose.connection;
    } catch (error) {
      console.error(`❌ Помилка підключення до MongoDB (Attempt ${i + 1}/${retries}):`, error.message);
      if (i === retries - 1) {
        console.error('🔥 Failed to connect to MongoDB after maximum retries.');
        throw error;
      }
      const waitTime = Math.min(1000 * Math.pow(2, i), 10000); // 1s, 2s, 4s, 8s, 10s...
      console.log(`⏳ Waiting ${waitTime / 1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
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

