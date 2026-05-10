const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const Analytics = require('../models/Analytics');
const User = require('../models/User');
const ingestionService = require('../services/ingestionService');
const logger = require('../utils/logger');
const Joi = require('joi');

const adminActionSchema = Joi.object({
  action: Joi.string().valid('toggle_source', 'clear_cache', 'run_ingestion', 'update_insights', 'cleanup_expired').required(),
  params: Joi.object().optional()
});

const bulkActionSchema = Joi.object({
  propertyIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).required(),
  action: Joi.string().valid('delete', 'deactivate', 'activate', 'feature', 'unfeature').required()
});

router.use((req, res, next) => {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
  next();
});

router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalProperties,
      activeProperties,
      newPropertiesToday,
      totalUsers,
      connectedUsers,
      ingestionStats,
      recentActivity,
      systemHealth
    ] = await Promise.all([
      Property.countDocuments({}),
      Property.countDocuments({ isActive: true, status: 'available' }),
      Property.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      User.countDocuments({}),
      getConnectedUsersCount(),
      getIngestionStats(),
      getRecentActivity(),
      getSystemHealth()
    ]);

    const analytics = await Analytics.getDailyStats(new Date());

    res.json({
      success: true,
      data: {
        overview: {
          totalProperties,
          activeProperties,
          newPropertiesToday,
          totalUsers,
          connectedUsers
        },
        metrics: analytics?.metrics || {},
        ingestion: ingestionStats,
        recentActivity,
        systemHealth,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/properties', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      propertyType,
      city,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search
    } = req.query;

    const query = {};
    
    if (status) query.status = status;
    if (propertyType) query.propertyType = propertyType;
    if (city) query['location.city'] = { $regex: city, $options: 'i' };
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { 'location.address': { $regex: search, $options: 'i' } },
        { 'source.platform': { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const properties = await Property.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('source')
      .select('title price location propertyType status isActive views contacts createdAt source aiInsights');

    const total = await Property.countDocuments(query);

    res.json({
      success: true,
      data: {
        properties,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        filters: {
          status,
          propertyType,
          city,
          search
        }
      }
    });

  } catch (error) {
    logger.error('Admin properties list error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/users', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      role,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search
    } = req.query;

    const query = {};
    
    if (role) query.role = role;
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (status === 'banned') query.isBanned = true;
    
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const users = await User.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('firstName lastName email role isActive isBanned createdAt activity');

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        filters: {
          role,
          status,
          search
        }
      }
    });

  } catch (error) {
    logger.error('Admin users list error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/ingestion/status', async (req, res) => {
  try {
    const stats = ingestionService.getStats();
    
    const recentAnalytics = await Analytics.find({})
      .sort({ date: -1 })
      .limit(7)
      .select('date metrics.ingestionRuns metrics.propertiesScraped');

    res.json({
      success: true,
      data: {
        current: stats,
        history: recentAnalytics,
        sources: stats.sources
      }
    });

  } catch (error) {
    logger.error('Ingestion status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/ingestion/toggle-source', async (req, res) => {
  try {
    const { sourceName, enabled } = req.body;
    
    if (!sourceName || typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Source name and enabled status are required'
      });
    }

    const success = await ingestionService.toggleSource(sourceName, enabled);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Source not found'
      });
    }

    res.json({
      success: true,
      message: `Source ${sourceName} ${enabled ? 'enabled' : 'disabled'} successfully`,
      data: {
        sourceName,
        enabled,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Toggle ingestion source error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/ingestion/run', async (req, res) => {
  try {
    if (ingestionService.isRunning) {
      return res.status(409).json({
        success: false,
        message: 'Ingestion is already running'
      });
    }

    ingestionService.runIngestion();
    
    res.json({
      success: true,
      message: 'Ingestion started successfully',
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Run ingestion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/bulk-action', async (req, res) => {
  try {
    const { error, value } = bulkActionSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { propertyIds, action } = value;
    
    const results = [];
    
    for (const propertyId of propertyIds) {
      try {
        const result = await performBulkAction(propertyId, action);
        results.push({
          propertyId,
          success: true,
          result
        });
      } catch (error) {
        results.push({
          propertyId,
          success: false,
          error: error.message
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      message: `Bulk action completed. Success: ${successful}, Failed: ${failed}`,
      data: {
        action,
        results,
        summary: {
          total: results.length,
          successful,
          failed
        }
      }
    });

  } catch (error) {
    logger.error('Bulk action error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/analytics/overview', async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    const dateRange = getDateRange(period);
    
    const [
      propertyStats,
      userStats,
      ingestionStats,
      performanceStats
    ] = await Promise.all([
      getPropertyAnalytics(dateRange),
      getUserAnalytics(dateRange),
      getIngestionAnalytics(dateRange),
      getPerformanceAnalytics()
    ]);

    res.json({
      success: true,
      data: {
        properties: propertyStats,
        users: userStats,
        ingestion: ingestionStats,
        performance: performanceStats,
        period: {
          type: period,
          startDate: dateRange.start,
          endDate: dateRange.end
        },
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Admin analytics overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/system/cleanup', async (req, res) => {
  try {
    const { cleanupType = 'all' } = req.body;
    
    let cleanupResults = {};
    
    if (cleanupType === 'all' || cleanupType === 'expired') {
      cleanupResults.expiredProperties = await cleanupExpiredProperties();
    }
    
    if (cleanupType === 'all' || cleanupType === 'inactive') {
      cleanupResults.inactiveUsers = await cleanupInactiveUsers();
    }
    
    if (cleanupType === 'all' || cleanupType === 'cache') {
      cleanupResults.cache = await cleanupCache();
    }
    
    res.json({
      success: true,
      message: 'System cleanup completed',
      data: cleanupResults,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('System cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/system/health', async (req, res) => {
  try {
    const health = await getSystemHealth();
    
    res.json({
      success: true,
      data: health,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('System health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/action', async (req, res) => {
  try {
    const { error, value } = adminActionSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action data',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { action, params } = value;
    
    let result;
    
    switch (action) {
      case 'toggle_source':
        result = await ingestionService.toggleSource(params.sourceName, params.enabled);
        break;
        
      case 'clear_cache':
        result = await clearSystemCache();
        break;
        
      case 'run_ingestion':
        if (ingestionService.isRunning) {
          return res.status(409).json({
            success: false,
            message: 'Ingestion is already running'
          });
        }
        ingestionService.runIngestion();
        result = { message: 'Ingestion started' };
        break;
        
      case 'update_insights':
        result = await updateAllInsights();
        break;
        
      case 'cleanup_expired':
        result = await cleanupExpiredProperties();
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Unknown action'
        });
    }
    
    res.json({
      success: true,
      message: `Action ${action} completed successfully`,
      data: result,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Admin action error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

async function getConnectedUsersCount() {
  return 0;
}

async function getIngestionStats() {
  const stats = ingestionService.getStats();
  return {
    isRunning: stats.isRunning,
    lastRun: stats.lastRun,
    totalProcessed: stats.totalProcessed,
    totalAdded: stats.totalAdded,
    totalErrors: stats.totalErrors
  };
}

async function getRecentActivity() {
  return await Property.find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .select('title price location createdAt isNewListing');
}

async function getSystemHealth() {
  return {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    timestamp: new Date()
  };
}

async function performBulkAction(propertyId, action) {
  const property = await Property.findById(propertyId);
  if (!property) {
    throw new Error('Property not found');
  }
  
  switch (action) {
    case 'delete':
      await Property.findByIdAndDelete(propertyId);
      return { action: 'deleted' };
      
    case 'deactivate':
      property.isActive = false;
      await property.save();
      return { action: 'deactivated' };
      
    case 'activate':
      property.isActive = true;
      await property.save();
      return { action: 'activated' };
      
    case 'feature':
      property.isFeatured = true;
      await property.save();
      return { action: 'featured' };
      
    case 'unfeature':
      property.isFeatured = false;
      await property.save();
      return { action: 'unfeatured' };
      
    default:
      throw new Error('Unknown action');
  }
}

async function getPropertyAnalytics(dateRange) {
  const query = {
    createdAt: { $gte: dateRange.start, $lte: dateRange.end }
  };
  
  return await Property.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        averagePrice: { $avg: '$price' },
        totalViews: { $sum: '$views' },
        totalContacts: { $sum: '$contacts' }
      }
    }
  ]);
}

async function getUserAnalytics(dateRange) {
  const query = {
    createdAt: { $gte: dateRange.start, $lte: dateRange.end }
  };
  
  return await User.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 }
      }
    }
  ]);
}

async function getIngestionAnalytics(dateRange) {
  const analytics = await Analytics.find({
    date: { $gte: dateRange.start, $lte: dateRange.end }
  });
  
  return {
    totalRuns: analytics.reduce((sum, a) => sum + (a.metrics.ingestionRuns || 0), 0),
    totalScraped: analytics.reduce((sum, a) => sum + (a.metrics.propertiesScraped || 0), 0)
  };
}

async function getPerformanceAnalytics() {
  return {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage()
  };
}

async function cleanupExpiredProperties() {
  const result = await Property.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  
  return { deleted: result.deletedCount };
}

async function cleanupInactiveUsers() {
  const cutoffDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  
  const result = await User.deleteMany({
    'activity.lastLogin': { $lt: cutoffDate },
    role: 'user'
  });
  
  return { deleted: result.deletedCount };
}

async function cleanupCache() {
  return { message: 'Cache cleared successfully' };
}

async function clearSystemCache() {
  return { message: 'System cache cleared' };
}

async function updateAllInsights() {
  const aiInsightsService = require('../services/aiInsightsService');
  return await aiInsightsService.batchUpdateInsights(100);
}

function getDateRange(period) {
  const now = new Date();
  let start, end;
  
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
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
  }
  
  return { start, end };
}

module.exports = router;
