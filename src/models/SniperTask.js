import mongoose from 'mongoose';

const sniperTaskSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    ref: 'User',
    required: true
  },
  botId: { // Scope task to specific bot instance (via token hash)
    type: String,
    required: true,
    index: true,
    default: 'global' // For backward compatibility
  },
  url: {
    type: String,
    required: true,
    index: true
  },
  productName: {
    type: String,
    required: true
  },
  productId: {
    type: String,
    required: false // Made optional for backward compatibility or if parsing fails initially
  },
  selectedColor: {
    name: String,
    value: String,
    skuPrefix: String,
    hex: String // Added for storing HEX/RGB
  },
  targetColor: { // Added alias/explicit field as requested
    type: String
  },
  targetColorRGB: { // Stored RGB style for strict verification
    type: String
  },
  selectedSize: {
    name: String,
    value: String
  },
  targetSize: { // Added alias/explicit field as requested
    type: String
  },
  skuId: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['hunting', 'paused', 'completed', 'failed', 'processing', 'pending_color', 'pending_size', 'SEARCHING', 'PENDING', 'MONITORING', 'at_checkout'],
    default: 'hunting',
    index: true
  },
  lastChecked: Date,
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 1000
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

sniperTaskSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('SniperTask', sniperTaskSchema);

