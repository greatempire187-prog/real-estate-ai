const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const aiInsightsService = require('../services/aiInsightsService');
const logger = require('../utils/logger');
const Joi = require('joi');

const batchUpdateSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(1000).default(100),
  propertyIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).optional()
});

const propertyIdSchema = Joi.object({
  id: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/)
});

const marketAnalysisSchema = Joi.object({
  city: Joi.string().required(),
  propertyType: Joi.string().optional()
});

router.post('/insights/batch-update', async (req, res) => {
  try {
    const { error, value } = batchUpdateSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { limit, propertyIds } = value;
    
    let results;
    
    if (propertyIds && propertyIds.length > 0) {
      results = [];
      
      for (const propertyId of propertyIds) {
        try {
          const insights = await aiInsightsService.updatePropertyInsights(propertyId);
          results.push({
            propertyId,
            success: true,
            insights
          });
        } catch (error) {
          results.push({
            propertyId,
            success: false,
            error: error.message
          });
        }
      }
    } else {
      results = await aiInsightsService.batchUpdateInsights(limit);
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      message: `Batch update completed. Success: ${successful}, Failed: ${failed}`,
      data: {
        results,
        summary: {
          total: results.length,
          successful,
          failed
        }
      }
    });

  } catch (error) {
    logger.error('Batch AI insights update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/insights/:id', async (req, res) => {
  try {
    const { error, value } = propertyIdSchema.validate(req.params);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid property ID',
        errors: error.details.map(detail => detail.message)
      });
    }

    const insights = await aiInsightsService.updatePropertyInsights(value.id);
    
    res.json({
      success: true,
      message: 'AI insights updated successfully',
      data: {
        propertyId: value.id,
        insights,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Property AI insights update error:', error);
    
    if (error.message === 'Property not found') {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/insights/:id', async (req, res) => {
  try {
    const { error, value } = propertyIdSchema.validate(req.params);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid property ID',
        errors: error.details.map(detail => detail.message)
      });
    }

    const property = await Property.findById(value.id).select('aiInsights title price location propertyType');
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        propertyId: value.id,
        title: property.title,
        price: property.price,
        location: property.location,
        propertyType: property.propertyType,
        insights: property.aiInsights,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Get AI insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/market-analysis', async (req, res) => {
  try {
    const { error, value } = marketAnalysisSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { city, propertyType } = value;
    
    const marketAnalysis = aiInsightsService.getMarketAnalysis(city, propertyType);
    
    const [
      topInvestmentProperties,
      priceTrends,
      demandMetrics
    ] = await Promise.all([
      getTopInvestmentProperties(city, propertyType),
      getPriceTrends(city, propertyType),
      getDemandMetrics(city, propertyType)
    ]);
    
    res.json({
      success: true,
      data: {
        city,
        propertyType,
        marketAnalysis,
        topInvestmentProperties,
        priceTrends,
        demandMetrics,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Market analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/recommendations/:id', async (req, res) => {
  try {
    const { error, value } = propertyIdSchema.validate(req.params);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid property ID',
        errors: error.details.map(detail => detail.message)
      });
    }

    const property = await Property.findById(value.id);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    const [
      similarProperties,
      investmentAlternatives,
      marketComparables
    ] = await Promise.all([
      getSimilarProperties(property),
      getInvestmentAlternatives(property),
      getMarketComparables(property)
    ]);
    
    const recommendations = generateRecommendations(property, {
      similarProperties,
      investmentAlternatives,
      marketComparables
    });
    
    res.json({
      success: true,
      data: {
        propertyId: value.id,
        recommendations,
        comparisons: {
          similarProperties,
          investmentAlternatives,
          marketComparables
        },
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Property recommendations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/investment-opportunities', async (req, res) => {
  try {
    const { 
      city, 
      propertyType, 
      minScore = 70, 
      limit = 20,
      sortBy = 'investmentScore',
      sortOrder = 'desc'
    } = req.query;
    
    const query = {
      isActive: true,
      status: 'available',
      'aiInsights.investmentScore': { $gte: parseInt(minScore) }
    };
    
    if (city) {
      query['location.city'] = { $regex: city, $options: 'i' };
    }
    
    if (propertyType) {
      query.propertyType = propertyType;
    }
    
    const sortOptions = {};
    sortOptions[`aiInsights.${sortBy}`] = sortOrder === 'desc' ? -1 : 1;
    
    const opportunities = await Property.find(query)
      .sort(sortOptions)
      .limit(parseInt(limit))
      .select('title price location propertyType aiInsights images bedrooms bathrooms area');
    
    const enhancedOpportunities = opportunities.map(property => {
      const propertyObj = property.toObject();
      
      propertyObj.investmentHighlights = generateInvestmentHighlights(propertyObj);
      propertyObj.riskAssessment = generateRiskAssessment(propertyObj);
      propertyObj.roiProjection = generateROIProjection(propertyObj);
      
      return propertyObj;
    });
    
    res.json({
      success: true,
      data: {
        opportunities: enhancedOpportunities,
        count: enhancedOpportunities.length,
        filters: {
          city,
          propertyType,
          minScore
        },
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Investment opportunities error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/price-estimator', async (req, res) => {
  try {
    const {
      city,
      propertyType,
      area,
      bedrooms,
      bathrooms,
      condition = 'good'
    } = req.query;
    
    if (!city || !propertyType || !area) {
      return res.status(400).json({
        success: false,
        message: 'City, property type, and area are required'
      });
    }
    
    const estimatedPrice = await estimatePropertyPrice({
      city: city.toLowerCase(),
      propertyType,
      area: parseFloat(area),
      bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
      bathrooms: bathrooms ? parseInt(bathrooms) : undefined,
      condition
    });
    
    const priceRange = calculatePriceRange(estimatedPrice);
    
    const comparableProperties = await getComparableProperties({
      city,
      propertyType,
      area,
      bedrooms,
      bathrooms
    });
    
    res.json({
      success: true,
      data: {
        criteria: {
          city,
          propertyType,
          area: parseFloat(area),
          bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
          bathrooms: bathrooms ? parseInt(bathrooms) : undefined,
          condition
        },
        estimation: {
          estimatedPrice,
          priceRange,
          confidence: calculateConfidence(comparableProperties.length)
        },
        comparables: comparableProperties,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Price estimator error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

async function getTopInvestmentProperties(city, propertyType, limit = 10) {
  const query = {
    isActive: true,
    status: 'available',
    'aiInsights.investmentScore': { $gte: 75 }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  
  return await Property.find(query)
    .sort({ 'aiInsights.investmentScore': -1 })
    .limit(limit)
    .select('title price location propertyType aiInsights');
}

async function getPriceTrends(city, propertyType) {
  const query = {
    isActive: true,
    createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  
  return await Property.aggregate([
    { $match: query },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        averagePrice: { $avg: '$price' },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } }
  ]);
}

async function getDemandMetrics(city, propertyType) {
  const query = {
    isActive: true,
    status: 'available'
  };
  
  if (city) query['location.city'] = { $regex: city, $options: 'i' };
  if (propertyType) query.propertyType = propertyType;
  
  const [
    totalViews,
    totalContacts,
    averageDaysOnMarket
  ] = await Promise.all([
    Property.aggregate([
      { $match: query },
      { $group: { _id: null, totalViews: { $sum: '$views' } } }
    ]),
    Property.aggregate([
      { $match: query },
      { $group: { _id: null, totalContacts: { $sum: '$contacts' } } }
    ]),
    Property.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          avgDays: { $avg: { $divide: [{ $subtract: [new Date(), '$createdAt'] }, 1000 * 60 * 60 * 24] } }
        }
      }
    ])
  ]);
  
  return {
    totalViews: totalViews[0]?.totalViews || 0,
    totalContacts: totalContacts[0]?.totalContacts || 0,
    averageDaysOnMarket: Math.round(averageDaysOnMarket[0]?.avgDays || 0),
    contactRate: totalViews[0]?.totalViews > 0 
      ? Math.round((totalContacts[0]?.totalContacts || 0) / totalViews[0].totalViews * 100)
      : 0
  };
}

async function getSimilarProperties(property, limit = 6) {
  return await Property.find({
    _id: { $ne: property._id },
    isActive: true,
    status: 'available',
    propertyType: property.propertyType,
    'location.city': property.location.city,
    price: { 
      $gte: property.price * 0.7, 
      $lte: property.price * 1.3 
    }
  })
  .sort({ 'aiInsights.investmentScore': -1 })
  .limit(limit)
  .select('title price location propertyType aiInsights images bedrooms bathrooms area');
}

async function getInvestmentAlternatives(property, limit = 6) {
  return await Property.find({
    _id: { $ne: property._id },
    isActive: true,
    status: 'available',
    'aiInsights.investmentScore': { $gte: property.aiInsights.investmentScore },
    price: { 
      $gte: property.price * 0.5, 
      $lte: property.price * 1.5 
    }
  })
  .sort({ 'aiInsights.investmentScore': -1 })
  .limit(limit)
  .select('title price location propertyType aiInsights images bedrooms bathrooms area');
}

async function getMarketComparables(property, limit = 10) {
  return await Property.find({
    _id: { $ne: property._id },
    isActive: true,
    status: 'available',
    propertyType: property.propertyType,
    'location.city': property.location.city,
    area: { 
      $gte: property.area * 0.8, 
      $lte: property.area * 1.2 
    }
  })
  .sort({ price: 1 })
  .limit(limit)
  .select('title price area location propertyType aiInsights');
}

function generateRecommendations(property, comparisons) {
  const recommendations = [];
  
  if (property.aiInsights.investmentScore >= 85) {
    recommendations.push({
      type: 'strong_buy',
      title: 'Excellent Investment Opportunity',
      description: 'This property shows strong investment potential with high ROI expectations.',
      priority: 'high'
    });
  } else if (property.aiInsights.investmentScore >= 70) {
    recommendations.push({
      type: 'buy',
      title: 'Good Investment Opportunity',
      description: 'This property offers solid investment potential with moderate risk.',
      priority: 'medium'
    });
  }
  
  if (property.aiInsights.rentalYield > 8) {
    recommendations.push({
      type: 'rental',
      title: 'High Rental Yield Potential',
      description: `Expected rental yield of ${property.aiInsights.rentalYield}% is above market average.`,
      priority: 'medium'
    });
  }
  
  if (property.aiInsights.priceTrend === 'rising') {
    recommendations.push({
      type: 'appreciation',
      title: 'Price Appreciation Expected',
      description: 'Market trends indicate potential price appreciation in this area.',
      priority: 'medium'
    });
  }
  
  if (comparisons.similarProperties.length > 0) {
    const avgSimilarPrice = comparisons.similarProperties.reduce((sum, p) => sum + p.price, 0) / comparisons.similarProperties.length;
    
    if (property.price < avgSimilarPrice * 0.9) {
      recommendations.push({
        type: 'value',
        title: 'Priced Below Market',
        description: 'This property is priced competitively compared to similar properties.',
        priority: 'high'
      });
    }
  }
  
  return recommendations;
}

function generateInvestmentHighlights(property) {
  const highlights = [];
  
  if (property.aiInsights.investmentScore >= 80) {
    highlights.push('High investment score');
  }
  
  if (property.aiInsights.rentalYield > 7) {
    highlights.push(`Strong rental yield (${property.aiInsights.rentalYield}%)`);
  }
  
  if (property.aiInsights.areaPopularity > 80) {
    highlights.push('High demand area');
  }
  
  if (property.aiInsights.priceTrend === 'rising') {
    highlights.push('Price appreciation potential');
  }
  
  if (property.isNewListing) {
    highlights.push('New listing');
  }
  
  return highlights;
}

function generateRiskAssessment(property) {
  let riskLevel = 'low';
  const factors = [];
  
  if (property.aiInsights.investmentScore < 50) {
    riskLevel = 'high';
    factors.push('Low investment score');
  } else if (property.aiInsights.investmentScore < 70) {
    riskLevel = 'medium';
    factors.push('Moderate investment score');
  }
  
  if (property.aiInsights.priceTrend === 'declining') {
    riskLevel = 'high';
    factors.push('Declining price trend');
  }
  
  if (property.aiInsights.areaPopularity < 50) {
    factors.push('Low area popularity');
  }
  
  if (property.condition === 'needs_renovation') {
    factors.push('Property needs renovation');
  }
  
  return {
    level: riskLevel,
    factors,
    score: Math.max(0, Math.min(100, 100 - property.aiInsights.investmentScore))
  };
}

function generateROIProjection(property) {
  const annualRentalIncome = property.aiInsights.estimatedMonthlyRent * 12;
  const rentalYield = property.aiInsights.rentalYield;
  
  let appreciationRate = 0.05;
  if (property.aiInsights.priceTrend === 'rising') appreciationRate = 0.08;
  if (property.aiInsights.priceTrend === 'declining') appreciationRate = 0.02;
  
  const annualAppreciation = property.price * appreciationRate;
  const totalAnnualReturn = annualRentalIncome + annualAppreciation;
  const totalROI = (totalAnnualReturn / property.price) * 100;
  
  return {
    rentalYield,
    appreciationRate,
    totalROI: Math.round(totalROI * 100) / 100,
    annualRentalIncome,
    annualAppreciation,
    projectedValue5Years: property.price * Math.pow(1 + appreciationRate, 5)
  };
}

async function estimatePropertyPrice(criteria) {
  const query = {
    isActive: true,
    status: 'available',
    'location.city': { $regex: criteria.city, $options: 'i' },
    propertyType: criteria.propertyType
  };
  
  if (criteria.bedrooms) query.bedrooms = criteria.bedrooms;
  if (criteria.bathrooms) query.bathrooms = criteria.bathrooms;
  
  const comparableProperties = await Property.find(query)
    .select('price area bedrooms bathrooms condition aiInsights.pricePerSqm');
  
  if (comparableProperties.length === 0) {
    return 0;
  }
  
  const avgPricePerSqm = comparableProperties.reduce((sum, p) => 
    sum + (p.aiInsights.pricePerSqm || p.price / p.area), 0) / comparableProperties.length;
  
  let estimatedPrice = avgPricePerSqm * criteria.area;
  
  if (criteria.bedrooms) {
    const avgBedroomPremium = comparableProperties.reduce((sum, p) => 
      sum + (p.bedrooms ? p.price / p.bedrooms : 0), 0) / comparableProperties.length;
    estimatedPrice = (estimatedPrice + avgBedroomPremium * criteria.bedrooms) / 2;
  }
  
  const conditionMultipliers = {
    'new': 1.15,
    'excellent': 1.10,
    'good': 1.0,
    'fair': 0.85,
    'needs_renovation': 0.70
  };
  
  estimatedPrice *= conditionMultipliers[criteria.condition] || 1.0;
  
  return Math.round(estimatedPrice);
}

function calculatePriceRange(estimatedPrice) {
  return {
    low: Math.round(estimatedPrice * 0.85),
    estimated: estimatedPrice,
    high: Math.round(estimatedPrice * 1.15)
  };
}

function calculateConfidence(comparableCount) {
  if (comparableCount >= 20) return 'high';
  if (comparableCount >= 10) return 'medium';
  if (comparableCount >= 5) return 'low';
  return 'very_low';
}

async function getComparableProperties(criteria) {
  const query = {
    isActive: true,
    status: 'available',
    'location.city': { $regex: criteria.city, $options: 'i' },
    propertyType: criteria.propertyType,
    area: { 
      $gte: criteria.area * 0.7, 
      $lte: criteria.area * 1.3 
    }
  };
  
  if (criteria.bedrooms) query.bedrooms = criteria.bedrooms;
  if (criteria.bathrooms) query.bathrooms = criteria.bathrooms;
  
  return await Property.find(query)
    .sort({ price: 1 })
    .limit(10)
    .select('title price area bedrooms bathrooms location images');
}

module.exports = router;
