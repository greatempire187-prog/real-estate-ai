const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const Joi = require('joi');
const logger = require('../utils/logger');
const geocodingService = require('../services/geocodingService');
const aiInsightsService = require('../services/aiInsightsService');

const propertyQuerySchema = Joi.object({
  query: Joi.string().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().valid('price', 'createdAt', 'views', 'aiInsights.investmentScore', 'area').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  priceMin: Joi.number().min(0).optional(),
  priceMax: Joi.number().min(0).optional(),
  propertyType: Joi.string().valid('apartment', 'house', 'villa', 'condo', 'townhouse', 'land', 'commercial').optional(),
  listingType: Joi.string().valid('sale', 'rent', 'lease').optional(),
  bedrooms: Joi.number().integer().min(0).max(20).optional(),
  bathrooms: Joi.number().integer().min(0).max(20).optional(),
  areaMin: Joi.number().min(0).optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  coordinates: Joi.array().items(Joi.number()).length(2).optional(),
  radius: Joi.number().min(0.1).max(100).optional(),
  isNewListing: Joi.boolean().optional(),
  investmentScoreMin: Joi.number().min(0).max(100).optional(),
  recommendationLabel: Joi.string().valid('best_deal', 'good_value', 'fair_price', 'overpriced').optional(),
  features: Joi.array().items(Joi.string()).optional(),
  amenities: Joi.array().items(Joi.string()).optional()
});

const propertyIdSchema = Joi.object({
  id: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/)
});

router.get('/', async (req, res) => {
  try {
    const { error, value } = propertyQuerySchema.validate(req.query);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.details.map(detail => detail.message)
      });
    }

    const {
      query,
      page,
      limit,
      sortBy,
      sortOrder,
      ...filters
    } = value;

    const searchQuery = buildSearchQuery(query, filters);
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const properties = await Property.find(searchQuery)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('source');

    const total = await Property.countDocuments(searchQuery);

    const enhancedProperties = properties.map(property => {
      const propertyObj = property.toObject();
      
      if (propertyObj.location && propertyObj.location.coordinates) {
        propertyObj.distance = filters.coordinates && filters.radius
          ? geocodingService.calculateDistance(
              filters.coordinates[1],
              filters.coordinates[0],
              propertyObj.location.coordinates[1],
              propertyObj.location.coordinates[0]
            )
          : null;
      }

      propertyObj.daysOnMarket = propertyObj.daysOnMarket || 0;
      propertyObj.isExpired = propertyObj.isExpired || false;

      return propertyObj;
    });

    res.json({
      success: true,
      data: {
        properties: enhancedProperties,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        filters: {
          applied: filters,
          query
        },
        meta: {
          timestamp: new Date(),
          searchTime: Date.now() - req.startTime
        }
      }
    });

  } catch (error) {
    logger.error('Properties search error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/featured', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const properties = await Property.find({
      isActive: true,
      status: 'available',
      isFeatured: true
    })
    .sort({ 'aiInsights.investmentScore': -1, views: -1 })
    .limit(parseInt(limit))
    .populate('source');

    res.json({
      success: true,
      data: {
        properties,
        count: properties.length,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Featured properties error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/new-listings', async (req, res) => {
  try {
    const { limit = 20, hours = 24 } = req.query;
    
    const cutoffDate = new Date(Date.now() - (parseInt(hours) * 60 * 60 * 1000));
    
    const properties = await Property.find({
      isActive: true,
      status: 'available',
      createdAt: { $gte: cutoffDate }
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .populate('source');

    res.json({
      success: true,
      data: {
        properties,
        count: properties.length,
        timeWindow: `${hours} hours`,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('New listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/nearby', async (req, res) => {
  try {
    const { coordinates, radius = 10, limit = 20 } = req.query;
    
    if (!coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates are required (lat,lng)'
      });
    }

    const [lat, lng] = coordinates.split(',').map(coord => parseFloat(coord.trim()));
    
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates format'
      });
    }

    const properties = await Property.findNearby([lng, lat], radius * 1000)
      .limit(parseInt(limit))
      .populate('source');

    const propertiesWithDistance = properties.map(property => {
      const propertyObj = property.toObject();
      propertyObj.distance = geocodingService.calculateDistance(
        lat, lng,
        propertyObj.location.coordinates[1],
        propertyObj.location.coordinates[0]
      );
      return propertyObj;
    });

    res.json({
      success: true,
      data: {
        properties: propertiesWithDistance,
        count: propertiesWithDistance.length,
        searchCenter: { lat, lng },
        radius: `${radius}km`,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Nearby properties error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/search/suggestions', async (req, res) => {
  try {
    const { q = '', limit = 10 } = req.query;
    
    if (q.length < 2) {
      return res.json({
        success: true,
        data: {
          suggestions: []
        }
      });
    }

    const suggestions = await Property.aggregate([
      {
        $match: {
          isActive: true,
          status: 'available',
          $or: [
            { title: { $regex: q, $options: 'i' } },
            { 'location.city': { $regex: q, $options: 'i' } },
            { 'location.state': { $regex: q, $options: 'i' } },
            { 'location.address': { $regex: q, $options: 'i' } }
          ]
        }
      },
      {
        $project: {
          title: 1,
          'location.city': 1,
          'location.state': 1,
          'location.address': 1,
          propertyType: 1,
          score: { $meta: 'textScore' }
        }
      },
      { $limit: parseInt(limit) }
    ]);

    const processedSuggestions = suggestions.map(item => ({
      text: item.title,
      type: 'property',
      subtype: item.propertyType,
      location: `${item.location.city}, ${item.location.state}`
    }));

    const citySuggestions = await Property.distinct('location.city', {
      isActive: true,
      'location.city': { $regex: q, $options: 'i' }
    }).limit(5);

    citySuggestions.forEach(city => {
      processedSuggestions.push({
        text: city,
        type: 'city',
        subtype: 'location'
      });
    });

    res.json({
      success: true,
      data: {
        suggestions: processedSuggestions.slice(0, limit)
      }
    });

  } catch (error) {
    logger.error('Search suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/filters/options', async (req, res) => {
  try {
    const [
      propertyTypes,
      cities,
      states,
      priceRanges
    ] = await Promise.all([
      Property.distinct('propertyType', { isActive: true, status: 'available' }),
      Property.distinct('location.city', { isActive: true, status: 'available' }),
      Property.distinct('location.state', { isActive: true, status: 'available' }),
      Property.aggregate([
        { $match: { isActive: true, status: 'available' } },
        {
          $group: {
            _id: null,
            minPrice: { $min: '$price' },
            maxPrice: { $max: '$price' },
            avgPrice: { $avg: '$price' }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        propertyTypes,
        cities: cities.sort(),
        states: states.sort(),
        priceRanges: priceRanges[0] || { minPrice: 0, maxPrice: 0, avgPrice: 0 },
        bedroomOptions: [1, 2, 3, 4, 5, 6],
        bathroomOptions: [1, 2, 3, 4, 5],
        listingTypes: ['sale', 'rent', 'lease'],
        recommendationLabels: ['best_deal', 'good_value', 'fair_price', 'overpriced']
      }
    });

  } catch (error) {
    logger.error('Filter options error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { error, value } = propertyIdSchema.validate(req.params);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid property ID',
        errors: error.details.map(detail => detail.message)
      });
    }

    const property = await Property.findById(value.id)
      .populate('source');

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    if (!property.isActive) {
      return res.status(410).json({
        success: false,
        message: 'Property is no longer available'
      });
    }

    await property.incrementViews();

    const similarProperties = await Property.find({
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
    .limit(6)
    .select('title price location images propertyType bedrooms bathrooms area');

    res.json({
      success: true,
      data: {
        property: property.toObject(),
        similarProperties,
        meta: {
          views: property.views,
          daysOnMarket: property.daysOnMarket,
          isExpired: property.isExpired
        }
      }
    });

  } catch (error) {
    logger.error('Property details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/:id/contact', async (req, res) => {
  try {
    const { error: idError, value: idValue } = propertyIdSchema.validate(req.params);
    
    if (idError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid property ID',
        errors: idError.details.map(detail => detail.message)
      });
    }

    const contactSchema = Joi.object({
      name: Joi.string().required().min(2).max(100),
      email: Joi.string().required().email(),
      phone: Joi.string().optional(),
      message: Joi.string().required().min(10).max(1000),
      preferredContact: Joi.string().valid('email', 'phone', 'whatsapp').default('email')
    });

    const { error: contactError, value: contactData } = contactSchema.validate(req.body);
    
    if (contactError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact data',
        errors: contactError.details.map(detail => detail.message)
      });
    }

    const property = await Property.findById(idValue.id);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    await property.incrementContacts();

    logger.info('Property contact request:', {
      propertyId: property._id,
      propertyTitle: property.title,
      contactData
    });

    res.json({
      success: true,
      message: 'Contact request sent successfully',
      data: {
        propertyId: property._id,
        contacts: property.contacts,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Property contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/:id/insights', async (req, res) => {
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

    const insights = await aiInsightsService.updatePropertyInsights(property._id);

    res.json({
      success: true,
      message: 'AI insights updated successfully',
      data: {
        insights,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Update insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

function buildSearchQuery(query, filters) {
  const searchQuery = {
    isActive: true,
    status: 'available'
  };

  if (query) {
    searchQuery.$or = [
      { title: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } },
      { 'location.address': { $regex: query, $options: 'i' } },
      { 'location.city': { $regex: query, $options: 'i' } },
      { 'location.state': { $regex: query, $options: 'i' } },
      { features: { $in: [new RegExp(query, 'i')] } },
      { amenities: { $in: [new RegExp(query, 'i')] } }
    ];
  }

  if (filters.priceMin || filters.priceMax) {
    searchQuery.price = {};
    if (filters.priceMin) searchQuery.price.$gte = filters.priceMin;
    if (filters.priceMax) searchQuery.price.$lte = filters.priceMax;
  }

  if (filters.propertyType) {
    searchQuery.propertyType = filters.propertyType;
  }

  if (filters.listingType) {
    searchQuery.listingType = filters.listingType;
  }

  if (filters.bedrooms) {
    searchQuery.bedrooms = { $gte: filters.bedrooms };
  }

  if (filters.bathrooms) {
    searchQuery.bathrooms = { $gte: filters.bathrooms };
  }

  if (filters.areaMin) {
    searchQuery.area = { $gte: filters.areaMin };
  }

  if (filters.city) {
    searchQuery['location.city'] = { $regex: filters.city, $options: 'i' };
  }

  if (filters.state) {
    searchQuery['location.state'] = { $regex: filters.state, $options: 'i' };
  }

  if (filters.coordinates && filters.radius) {
    searchQuery['location.coordinates'] = {
      $geoWithin: {
        $centerSphere: [filters.coordinates, filters.radius / 6371]
      }
    };
  }

  if (filters.isNewListing !== undefined) {
    searchQuery.isNewListing = filters.isNewListing;
  }

  if (filters.investmentScoreMin) {
    searchQuery['aiInsights.investmentScore'] = { $gte: filters.investmentScoreMin };
  }

  if (filters.recommendationLabel) {
    searchQuery['aiInsights.recommendationLabel'] = filters.recommendationLabel;
  }

  if (filters.features && filters.features.length > 0) {
    searchQuery.features = { $in: filters.features };
  }

  if (filters.amenities && filters.amenities.length > 0) {
    searchQuery.amenities = { $in: filters.amenities };
  }

  return searchQuery;
}

module.exports = router;
