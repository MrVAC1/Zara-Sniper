import mongoose from 'mongoose';

const logSchema = new mongoose.Schema({
  level: {
    type: String,
    required: true,
    enum: ['INFO', 'WARN', 'ERROR', 'DEBUG']
  },
  message: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed }, // Arbitrary data
  timestamp: { type: Date, default: Date.now }
}, {
  capped: { size: 1048576, max: 5000 }, // 1MB or 5000 entries
  versionKey: false
});

const Log = mongoose.models.Log || mongoose.model('Log', logSchema);

export default Log;
