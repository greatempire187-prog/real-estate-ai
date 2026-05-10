const express = require('express');
const router = express.Router();
const Analytics = require('../models/Analytics');
const Property = require('../models/Property');
const logger = require('../utils/logger');
const Joi = require('joi');

const analyticsQuerySchema = Joi.object({
  period: Joi.string().valid('today', 'week', 'month', 'quarter', 'year').default('today'),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  city: Joi.string().optional(),
  propertyType: Joi.string().optional(),
  listingType: Joi.string().optional()
});

router.get('/dashboard', async (req, res) => {
  try {
    const { error, value } = analyticsQuerySchema.validate(req.query);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { period, startDate, endDate, city, propertyType, listingType } = value;
    
    const dateRange = getDateRange(period, startDate, endDate);
    
    const [
      totalListings,
      newListings,
      activeListings,
      soldListings,
      priceStats,
      topCities,
      topPropertyTypes,
      recentActivity
    ] = await Promise.all([
      getTotalListings(dateRange, city, propertyType, listingType),
      getNewListings(dateRange, city, propertyType, listingType),
      getActiveListings(city, propertyType, listingType),
      getSoldListings(dateRange, city, propertyType, listingType),
      getPriceStats(dateRange, city, propertyType, listingType),
      getTopCities(dateRange),
      getTopPropertyTypes(dateRange),
      getRecentActivity()
    ]);

    const analytics = await Analytics.getDailyStats(new Date());
    
    res.json({
      success: true,
      data: {
        overview: {
          totalListings,
          newListings,
          activeListings,
          soldListings,
          averagePrice: priceStats.averagePrice,
          medianPrice: priceStats.medianPrice,
          priceRange: {
            min: priceStats.minPrice,
            max: priceStats.maxPrice
          }
        },
        breakdown: {
          topCities,
          topPropertyTypes
        },
        metrics: analytics?.metrics || {},
        recentActivity,
        period: {
          type: period,
          startDate: dateRange.start,
          endDate: dateRange.end
        },
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/trends', async (req, res) => {
  try {
    const { period = 'month', city, propertyType } = req.query;
    
    const dateRange = getDateRange(period);
    
    const priceTrends = await getPriceTrends(dateRange, city, propertyType);
    const volumeTrends = await getVolumeTrends(dateRange, city, propertyType);
    const inventoryTrends = await getInventoryTrends(dateRange, city, propertyType);
    
    res.json({
      success: true,
      data: {
        priceTrends,
        volumeTrends,
        inventoryTrends,
        period: {
          type: period,
          startDate: dateRange.start,
          endDate: dateRange.end
        },
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Analytics trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/market-insights', async (req, res) => {
  try {
    const { city } = req.query;
    
    const [
      marketOverview,
      investmentOpportunities,
      priceComparison,
      demandIndicators
    ] = await Promise.all([
      getMarketOverview(city),
      getInvestmentOpportunities(city),
      getPriceComparison(city),
      getDemandIndicators(city)
    ]);
    
    res.json({
      success: true,
      data: {
        marketOverview,
        investmentOpportunities,
        priceComparison,
        demandIndicators,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Market insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/performance', async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    const dateRange = getDateRange(period);
    
    const [
      ingestionStats,
      searchStats,
      userEngagement,
      systemPerformance
    ] = await Promise.all([
      getIngestionStats(dateRange),
      getSearchStats(dateRange),
      getUserEngagementStats(dateRange),
      getSystemPerformanceStats()
    ]);
    
    res.json({
      success: true,
      data: {
        ingestion: ingestionStats,
        search: searchStats,
        userEngagement,
        systemPerformance,
        period: {
          type: period,
          startDate: dateRange.start,
          endDate: dateRange.end
        },
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Performance analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/export', async (req, res) => {
  try {
    const { 
      format = 'json', 
      period = 'month',
      includeProperties = false 
    } = req.query;
    
    const dateRange = getDateRange(period);
    
    const analyticsData = await generateAnalyticsReport(dateRange);
    
    if (includeProperties === 'true') {
      const properties = await Property.find({
        createdAt: {
          $gte: dateRange.start,
          $lte: dateRange.end
        }
      }).select('title price location propertyType listingType createdAt');
      
      analyticsData.properties = properties;
    }
    
    const filename = `analytics_${period}_${new Date().toISOString().split('T')[0]}`;
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(convertToCSV(analyticsData));
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    res.json(analyticsData);

  } catch (error) {
    logger.error('Analytics export error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

async function getTotalListings(dateRange, city, propertyType, listingType) {
  const query = {
    isActive: true,
    createdAt: {
      $gte: dateRange.start,
      $lte: dateRange.end
    }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  if (listingType) query.listingType = listingType;
  
  return await Property.countDocuments(query);
}

async function getNewListings(dateRange, city, propertyType, listingType) {
  const query = {
    isActive: true,
    createdAt: {
      $gte: dateRange.start,
      $lte: dateRange.end
    }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  if (listingType) query.listingType = listingType;
  
  return await Property.countDocuments(query);
}

async function getActiveListings(city, propertyType, listingType) {
  const query = {
    isActive: true,
    status: 'available'
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  if (listingType) query.listingType = listingType;
  
  return await Property.countDocuments(query);
}

async function getSoldListings(dateRange, city, propertyType, listingType) {
  const query = {
    status: 'sold',
    updatedAt: {
      $gte: dateRange.start,
      $lte: dateRange.end
    }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  if (listingType) query.listingType = listingType;
  
  return await Property.countDocuments(query);
}

async function getPriceStats(dateRange, city, propertyType, listingType) {
  const query = {
    isActive: true,
    status: 'available'
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  if (listingType) query.listingType = listingType;
  
  const stats = await Property.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        averagePrice: { $avg: '$price' },
        medianPrice: { $median: { input: '$price', method: 'approximate' } },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' }
      }
    }
  ]);
  
  return stats[0] || {
    averagePrice: 0,
    medianPrice: 0,
    minPrice: 0,
    maxPrice: 0
  };
}

async function getTopCities(dateRange) {
  return await Property.aggregate([
    {
      $match: {
        isActive: true,
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $group: {
        _id: '$location.city',
        count: { $sum: 1 },
        averagePrice: { $avg: '$price' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
    {
      $project: {
        city: '$_id',
        count: 1,
        averagePrice: { $round: ['$averagePrice', 2] }
      }
    }
  ]);
}

async function getTopPropertyTypes(dateRange) {
  return await Property.aggregate([
    {
      $match: {
        isActive: true,
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $group: {
        _id: '$propertyType',
        count: { $sum: 1 },
        averagePrice: { $avg: '$price' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
    {
      $project: {
        propertyType: '$_id',
        count: 1,
        averagePrice: { $round: ['$averagePrice', 2] }
      }
    }
  ]);
}

async function getRecentActivity() {
  return await Property.find({
    isActive: true
  })
  .sort({ createdAt: -1 })
  .limit(5)
  .select('title price location propertyType createdAt isNewListing')
  .lean();
}

async function getPriceTrends(dateRange, city, propertyType) {
  const query = {
    isActive: true,
    createdAt: { $gte: dateRange.start, $lte: dateRange.end }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  
  return await Property.aggregate([
    { $match: query },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        averagePrice: { $avg: '$price' },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]);
}

async function getVolumeTrends(dateRange, city, propertyType) {
  const query = {
    isActive: true,
    createdAt: { $gte: dateRange.start, $lte: dateRange.end }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  
  return await Property.aggregate([
    { $match: query },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        volume: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]);
}

async function getInventoryTrends(dateRange, city, propertyType) {
  const query = {
    isActive: true
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  
  return await Property.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        averagePrice: { $avg: '$price' }
      }
    }
  ]);
}

async function getMarketOverview(city) {
  const query = city ? { 'location.city': { $regex: city, $options: 'i' } } : {};
  
  const [
    totalProperties,
    averagePrice,
    averageDaysOnMarket,
    pricePerSqm
  ] = await Promise.all([
    Property.countDocuments({ ...query, isActive: true }),
    Property.aggregate([
      { $match: { ...query, isActive: true, status: 'available' } },
      { $group: { _id: null, avgPrice: { $avg: '$price' } } }
    ]),
    Property.aggregate([
      { $match: { ...query, isActive: true } },
      {
        $group: {
          _id: null,
          avgDays: { $avg: { $divide: [{ $subtract: [new Date(), '$createdAt'] }, 1000 * 60 * 60 * 24] } }
        }
      }
    ]),
    Property.aggregate([
      { $match: { ...query, isActive: true, status: 'available' } },
      { $group: { _id: null, avgPricePerSqm: { $avg: { $divide: ['$price', '$area'] } } } }
    ])
  ]);
  
  return {
    totalProperties,
    averagePrice: averagePrice[0]?.avgPrice || 0,
    averageDaysOnMarket: Math.round(averageDaysOnMarket[0]?.avgDays || 0),
    averagePricePerSqm: Math.round(pricePerSqm[0]?.avgPricePerSqm || 0)
  };
}

async function getInvestmentOpportunities(city) {
  const query = {
    isActive: true,
    status: 'available',
    'aiInsights.investmentScore': { $gte: 70 }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  
  return await Property.find(query)
    .sort({ 'aiInsights.investmentScore': -1 })
    .limit(10)
    .select('title price location aiInsights propertyType')
    .lean();
}

async function getPriceComparison(city) {
  const query = city ? { 'location.city': { $regex: city, $options: 'i' } } : {};
  
  return await Property.aggregate([
    { $match: { ...query, isActive: true, status: 'available' } },
    {
      $group: {
        _id: '$propertyType',
        averagePrice: { $avg: '$price' },
        medianPrice: { $median: { input: '$price', method: 'approximate' } },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
        count: { $sum: 1 }
      }
    },
    { $sort: { averagePrice: -1 } }
  ]);
}

async function getDemandIndicators(city) {
  const query = city ? { 'location.city': { $regex: city, $options: 'i' } } : {};
  
  const [
    totalViews,
    totalContacts,
    averageViewsPerProperty,
    contactRate
  ] = await Promise.all([
    Property.aggregate([
      { $match: { ...query, isActive: true } },
      { $group: { _id: null, totalViews: { $sum: '$views' } } }
    ]),
    Property.aggregate([
      { $match: { ...query, isActive: true } },
      { $group: { _id: null, totalContacts: { $sum: '$contacts' } } }
    ]),
    Property.aggregate([
      { $match: { ...query, isActive: true } },
      { $group: { _id: null, avgViews: { $avg: '$views' } } }
    ]),
    Property.aggregate([
      { $match: { ...query, isActive: true, views: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          contactRate: { $avg: { $divide: ['$contacts', '$views'] } }
        }
      }
    ])
  ]);
  
  return {
    totalViews: totalViews[0]?.totalViews || 0,
    totalContacts: totalContacts[0]?.totalContacts || 0,
    averageViewsPerProperty: Math.round(averageViewsPerProperty[0]?.avgViews || 0),
    contactRate: Math.round((contactRate[0]?.contactRate || 0) * 100)
  };
}

async function getIngestionStats(dateRange) {
  const analytics = await Analytics.find({
    date: { $gte: dateRange.start, $lte: dateRange.end }
  }).sort({ date: 1 });
  
  return {
    totalRuns: analytics.reduce((sum, a) => sum + (a.metrics.ingestionRuns || 0), 0),
    totalPropertiesScraped: analytics.reduce((sum, a) => sum + (a.metrics.propertiesScraped || 0), 0),
    averagePropertiesPerRun: analytics.length > 0 
      ? Math.round(analytics.reduce((sum, a) => sum + (a.metrics.propertiesScraped || 0), 0) / analytics.length)
      : 0
  };
}

async function getSearchStats(dateRange) {
  return {
    totalSearches: 0,
    averageSearchTime: 0,
    popularSearchTerms: []
  };
}

async function getUserEngagementStats(dateRange) {
  return {
    totalViews: await Property.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, totalViews: { $sum: '$views' } } }
    ]).then(result => result[0]?.totalViews || 0),
    totalContacts: await Property.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, totalContacts: { $sum: '$contacts' } } }
    ]).then(result => result[0]?.totalContacts || 0),
    averageSessionDuration: 0,
    bounceRate: 0
  };
}

async function getSystemPerformanceStats() {
  return {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    activeConnections: 0
  };
}

async function generateAnalyticsReport(dateRange) {
  const [
    totalListings,
    priceStats,
    topCities,
    topPropertyTypes
  ] = await Promise.all([
    getTotalListings(dateRange),
    getPriceStats(dateRange),
    getTopCities(dateRange),
    getTopPropertyTypes(dateRange)
  ]);
  
  return {
    period: dateRange,
    summary: {
      totalListings,
      averagePrice: priceStats.averagePrice,
      medianPrice: priceStats.medianPrice
    },
    breakdown: {
      cities: topCities,
      propertyTypes: topPropertyTypes
    },
    generatedAt: new Date()
  };
}

function getDateRange(period, customStart, customEnd) {
  const now = new Date();
  let start, end;
  
  if (customStart && customEnd) {
    start = new Date(customStart);
    end = new Date(customEnd);
  } else {
    switch (period) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        break;
      case 'week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = now;
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
        break;
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), quarter * 3, 1);
        end = now;
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        end = now;
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }
  }
  
  return { start, end };
}

function convertToCSV(data) {
  const items = data.properties || [];
  const headers = Object.keys(items[0] || {}).join(',');
  const rows = items.map(item => Object.values(item).join(','));
  return [headers, ...rows].join('\n');
}

module.exports = router;
