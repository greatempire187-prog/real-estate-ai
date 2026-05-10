const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    trim: true,
    match: [/^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/, 'Please enter a valid phone number']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'agent', 'admin', 'super_admin'],
    default: 'user'
  },
  profile: {
    avatar: String,
    bio: {
      type: String,
      maxlength: 500
    },
    company: String,
    license: String,
    specialties: [{
      type: String,
      enum: ['residential', 'commercial', 'luxury', 'investment', 'rental']
    }],
    languages: [{
      type: String,
      maxlength: 50
    }],
    website: String,
    socialMedia: {
      linkedin: String,
      twitter: String,
      instagram: String,
      facebook: String
    }
  },
  preferences: {
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      },
      newListings: {
        type: Boolean,
        default: true
      },
      priceChanges: {
        type: Boolean,
        default: false
      }
    },
    savedSearches: [{
      name: String,
      filters: mongoose.Schema.Types.Mixed,
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    favoriteProperties: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property'
    }]
  },
  activity: {
    lastLogin: Date,
    loginCount: {
      type: Number,
      default: 0
    },
    propertiesViewed: [{
      property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property'
      },
      viewedAt: {
        type: Date,
        default: Date.now
      }
    }],
    searchesPerformed: {
      type: Number,
      default: 0
    },
    contactsInitiated: {
      type: Number,
      default: 0
    }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    },
    city: String,
    state: String,
    country: {
      type: String,
      default: 'Nigeria'
    }
  },
  verification: {
    email: {
      isVerified: {
        type: Boolean,
        default: false
      },
      token: String,
      expiresAt: Date
    },
    phone: {
      isVerified: {
        type: Boolean,
        default: false
      },
      token: String,
      expiresAt: Date
    },
    profile: {
      isVerified: {
        type: Boolean,
        default: false
      },
      verifiedAt: Date,
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }
  },
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'premium', 'enterprise'],
      default: 'free'
    },
    startDate: Date,
    endDate: Date,
    features: [{
      type: String
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: String,
  bannedAt: Date,
  bannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'preferences.favoriteProperties': 1 });
userSchema.index({ 'location.coordinates': '2dsphere' });
userSchema.index({ 'activity.lastLogin': -1 });
userSchema.index({ createdAt: -1 });

userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual('isPremium').get(function() {
  return ['premium', 'enterprise'].includes(this.subscription.plan);
});

userSchema.virtual('isAgent').get(function() {
  return ['agent', 'admin', 'super_admin'].includes(this.role);
});

userSchema.pre('save', function(next) {
  if (this.isModified('password')) {
    const bcrypt = require('bcryptjs');
    this.password = bcrypt.hashSync(this.password, 10);
  }
  next();
});

userSchema.methods.comparePassword = function(candidatePassword) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(candidatePassword, this.password);
};

userSchema.methods.addToFavorites = function(propertyId) {
  if (!this.preferences.favoriteProperties.includes(propertyId)) {
    this.preferences.favoriteProperties.push(propertyId);
    return this.save();
  }
  return Promise.resolve(this);
};

userSchema.methods.removeFromFavorites = function(propertyId) {
  this.preferences.favoriteProperties = this.preferences.favoriteProperties.filter(
    id => id.toString() !== propertyId.toString()
  );
  return this.save();
};

userSchema.methods.recordPropertyView = function(propertyId) {
  this.activity.propertiesViewed.push({
    property: propertyId,
    viewedAt: new Date()
  });
  
  this.activity.propertiesViewed = this.activity.propertiesViewed.slice(-100);
  
  return this.save();
};

userSchema.methods.incrementSearchCount = function() {
  this.activity.searchesPerformed += 1;
  return this.save();
};

userSchema.methods.incrementContactCount = function() {
  this.activity.contactsInitiated += 1;
  return this.save();
};

userSchema.methods.recordLogin = function() {
  this.activity.lastLogin = new Date();
  this.activity.loginCount += 1;
  return this.save();
};

userSchema.statics.findNearbyAgents = function(coordinates, maxDistance = 50000) {
  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    },
    role: { $in: ['agent', 'admin'] },
    isActive: true,
    isBanned: false,
    'verification.profile.isVerified': true
  });
};

module.exports = mongoose.model('User', userSchema);
