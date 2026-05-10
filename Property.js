const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'NGN',
    enum: ['NGN', 'USD', 'GBP', 'EUR']
  },
  propertyType: {
    type: String,
    required: true,
    enum: ['apartment', 'house', 'villa', 'condo', 'townhouse', 'land', 'commercial']
  },
  bedrooms: {
    type: Number,
    min: 0,
    max: 20
  },
  bathrooms: {
    type: Number,
    min: 0,
    max: 20
  },
  area: {
    type: Number,
    required: true,
    min: 0
  },
  areaUnit: {
    type: String,
    default: 'sqm',
    enum: ['sqm', 'sqft', 'acres', 'hectares']
  },
  location: {
    address: {
      type: String,
      required: true,
      trim: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    state: {
      type: String,
      required: true,
      trim: true
    },
    country: {
      type: String,
      default: 'Nigeria',
      trim: true
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        required: true
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function(coordinates) {
            return coordinates.length === 2 && 
                   coordinates[0] >= -180 && coordinates[0] <= 180 &&
                   coordinates[1] >= -90 && coordinates[1] <= 90;
          },
          message: 'Invalid coordinates. Must be [longitude, latitude] within valid ranges.'
        }
      }
    }
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    caption: String,
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  features: [{
    type: String,
    trim: true
  }],
  amenities: [{
    type: String,
    trim: true
  }],
  yearBuilt: {
    type: Number,
    min: 1800,
    max: new Date().getFullYear() + 10
  },
  condition: {
    type: String,
    enum: ['new', 'excellent', 'good', 'fair', 'needs_renovation'],
    default: 'good'
  },
  status: {
    type: String,
    enum: ['available', 'pending', 'sold', 'rented', 'off_market'],
    default: 'available'
  },
  listingType: {
    type: String,
    enum: ['sale', 'rent', 'lease'],
    required: true
  },
  source: {
    platform: {
      type: String,
      required: true
    },
    url: String,
    listingId: String,
    scrapedAt: {
      type: Date,
      default: Date.now
    }
  },
  aiInsights: {
    investmentScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    areaPopularity: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    priceTrend: {
      type: String,
      enum: ['rising', 'stable', 'declining'],
      default: 'stable'
    },
    recommendationLabel: {
      type: String,
      enum: ['best_deal', 'good_value', 'fair_price', 'overpriced'],
      default: 'fair_price'
    },
    estimatedMonthlyRent: Number,
    rentalYield: Number,
    pricePerSqm: Number
  },
  views: {
    type: Number,
    default: 0
  },
  contacts: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isNewListing: {
    type: Boolean,
    default: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

propertySchema.index({ 'location.coordinates': '2dsphere' });
propertySchema.index({ city: 1, state: 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ propertyType: 1 });
propertySchema.index({ listingType: 1 });
propertySchema.index({ status: 1 });
propertySchema.index({ isNewListing: 1 });
propertySchema.index({ createdAt: -1 });
propertySchema.index({ 'aiInsights.investmentScore': -1 });
propertySchema.index({ 'aiInsights.recommendationLabel': 1 });

propertySchema.virtual('age').get(function() {
  return new Date().getFullYear() - this.yearBuilt;
});

propertySchema.virtual('daysOnMarket').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

propertySchema.virtual('isExpired').get(function() {
  return Date.now() > this.expiresAt;
});

propertySchema.pre('save', function(next) {
  if (this.isModified('price') && this.area) {
    this.aiInsights.pricePerSqm = this.price / this.area;
  }
  
  if (this.isNew) {
    this.isNewListing = true;
    setTimeout(() => {
      this.isNewListing = false;
      this.save().catch(err => console.error('Error updating new listing status:', err));
    }, 7 * 24 * 60 * 60 * 1000);
  }
  
  next();
});

propertySchema.statics.findNearby = function(coordinates, maxDistance = 10000) {
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
    isActive: true,
    status: 'available'
  });
};

propertySchema.statics.findWithinRadius = function(coordinates, radiusKm, filters = {}) {
  const query = {
    'location.coordinates': {
      $geoWithin: {
        $centerSphere: [coordinates, radiusKm / 6371]
      }
    },
    isActive: true,
    status: 'available',
    ...filters
  };
  
  return this.find(query);
};

propertySchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

propertySchema.methods.incrementContacts = function() {
  this.contacts += 1;
  return this.save();
};

propertySchema.methods.calculateInvestmentScore = function() {
  let score = 50;
  
  if (this.pricePerSqm && this.aiInsights.pricePerSqm) {
    const marketAvg = this.aiInsights.pricePerSqm;
    const priceRatio = this.pricePerSqm / marketAvg;
    
    if (priceRatio < 0.8) score += 20;
    else if (priceRatio < 0.9) score += 10;
    else if (priceRatio > 1.2) score -= 15;
    else if (priceRatio > 1.1) score -= 5;
  }
  
  if (this.aiInsights.areaPopularity > 80) score += 15;
  else if (this.aiInsights.areaPopularity > 60) score += 10;
  else if (this.aiInsights.areaPopularity < 40) score -= 10;
  
  if (this.condition === 'new' || this.condition === 'excellent') score += 10;
  else if (this.condition === 'needs_renovation') score -= 15;
  
  if (this.age < 5) score += 10;
  else if (this.age > 20) score -= 10;
  
  this.aiInsights.investmentScore = Math.max(0, Math.min(100, score));
  return this.aiInsights.investmentScore;
};

module.exports = mongoose.model('Property', propertySchema);
