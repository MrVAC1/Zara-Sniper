import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  isOwner: {
    type: Boolean,
    default: false
  },
  deliveryProfile: {
    firstName: String,
    lastName: String,
    phone: String,
    email: String,
    address: {
      street: String,
      city: String,
      postalCode: String,
      country: String
    }
  },
  session: {
    cookies: [Object],
    localStorage: Object
  },
  zaraCredentials: {
    email: {
      encrypted: String,
      iv: String,
      authTag: String
    },
    password: {
      encrypted: String,
      iv: String,
      authTag: String
    }
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

userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('User', userSchema);

