const Joi = require('joi');
const logger = require('../utils/logger');

const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details
        .map(detail => detail.message)
        .join(', ');

      logger.warn('Validation error:', {
        error: errorMessage,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }))
      });
    }

    req[property] = value;
    next();
  };
};

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
  recommendationLabel: Joi.string().valid('best_deal', 'good_value', 'fair_price', 'overpriced').optional()
});

const propertyIdSchema = Joi.object({
  id: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/)
});

const userRegistrationSchema = Joi.object({
  firstName: Joi.string().required().min(2).max(50).trim(),
  lastName: Joi.string().required().min(2).max(50).trim(),
  email: Joi.string().required().email().trim(),
  phone: Joi.string().optional().pattern(/^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/),
  password: Joi.string().required().min(6).max(128),
  role: Joi.string().valid('user', 'agent').default('user')
});

const userLoginSchema = Joi.object({
  email: Joi.string().required().email().trim(),
  password: Joi.string().required().min(1)
});

const contactFormSchema = Joi.object({
  name: Joi.string().required().min(2).max(100).trim(),
  email: Joi.string().required().email().trim(),
  phone: Joi.string().optional().pattern(/^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/),
  message: Joi.string().required().min(10).max(1000).trim(),
  preferredContact: Joi.string().valid('email', 'phone', 'whatsapp').default('email')
});

const analyticsQuerySchema = Joi.object({
  period: Joi.string().valid('today', 'week', 'month', 'quarter', 'year').default('today'),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  city: Joi.string().optional(),
  propertyType: Joi.string().optional(),
  listingType: Joi.string().optional()
});

const coordinatesSchema = Joi.object({
  lat: Joi.number().required().min(-90).max(90),
  lng: Joi.number().required().min(-180).max(180),
  radius: Joi.number().min(0.1).max(100).default(10)
});

module.exports = {
  validate,
  propertyQuerySchema,
  propertyIdSchema,
  userRegistrationSchema,
  userLoginSchema,
  contactFormSchema,
  analyticsQuerySchema,
  coordinatesSchema
};
