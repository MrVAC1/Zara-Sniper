import mongoose from 'mongoose';

const systemCacheSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g., 'global_zara_session'
  data: { type: Object, required: true }, // Playwright storageState
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  strict: false
});

const SystemCache = mongoose.models.SystemCache || mongoose.model('SystemCache', systemCacheSchema);

export default SystemCache;
