const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    unique: true
  },
  metrics: {
    totalListings: {
      type: Number,
      default: 0
    },
    newListings: {
      type: Number,
      default: 0
    },
    activeListings: {
      type: Number,
      default: 0
    },
    soldListings: {
      type: Number,
      default: 0
    },
    averagePrice: {
      type: Number,
      default: 0
    },
    medianPrice: {
      type: Number,
      default: 0
    },
    totalViews: {
      type: Number,
      default: 0
    },
    totalContacts: {
      type: Number,
      default: 0
    },
    connectedUsers: {
      type: Number,
      default: 0
    },
    ingestionRuns: {
      type: Number,
      default: 0
    },
    propertiesScraped: {
      type: Number,
      default: 0
    }
  },
  breakdown: {
    byPropertyType: [{
      type: String,
      count: Number,
      averagePrice: Number
    }],
    byCity: [{
      city: String,
      count: Number,
      averagePrice: Number
    }],
    byPriceRange: [{
      range: String,
      count: Number
    }],
    byListingType: [{
      type: String,
      count: Number,
      averagePrice: Number
    }]
  },
  trends: {
    priceChange: {
      type: Number,
      default: 0
    },
    volumeChange: {
      type: Number,
      default: 0
    },
    viewsChange: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

analyticsSchema.index({ date: -1 });
analyticsSchema.index({ 'metrics.totalListings': -1 });

analyticsSchema.statics.getDailyStats = function(date = new Date()) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return this.findOne({
    date: {
      $gte: startOfDay,
      $lte: endOfDay
    }
  });
};

analyticsSchema.statics.getWeeklyStats = function(date = new Date()) {
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - date.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  
  return this.find({
    date: {
      $gte: startOfWeek,
      $lte: endOfWeek
    }
  }).sort({ date: 1 });
};

analyticsSchema.statics.getMonthlyStats = function(date = new Date()) {
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  endOfMonth.setHours(23, 59, 59, 999);
  
  return this.find({
    date: {
      $gte: startOfMonth,
      $lte: endOfMonth
    }
  }).sort({ date: 1 });
};

module.exports = mongoose.model('Analytics', analyticsSchema);
