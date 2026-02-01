import mongoose from 'mongoose';

const blacklistSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  attempts: {
    type: Number,
    default: 1
  },
  blockedAt: {
    type: Date,
    default: Date.now
  },
  reason: String
});

export default mongoose.model('Blacklist', blacklistSchema);

