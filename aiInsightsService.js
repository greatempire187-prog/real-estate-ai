const Property = require('../models/Property');
const logger = require('../utils/logger');

class AIInsightsService {
  constructor() {
    this.priceRanges = {
      lagos: { low: 5000000, medium: 20000000, high: 100000000 },
      abuja: { low: 4000000, medium: 15000000, high: 80000000 },
      port_harcourt: { low: 3000000, medium: 12000000, high: 60000000 },
      kano: { low: 2000000, medium: 8000000, high: 40000000 },
      default: { low: 1500000, medium: 6000000, high: 30000000 }
    };
    
    this.areaPopularityScores = {
      'ikoyi': 95,
      'victoria island': 92,
      'lekki': 88,
      'ajah': 82,
      'ikeja': 85,
      'abuja municipal': 90,
      'maitama': 93,
      'asokoro': 91,
      'jabi': 84,
      'port harcourt township': 86,
      'gra': 87,
      'government reserved area': 88,
      'banana island': 96,
      'ikoyi': 95
    };
  }

  async generateInsights(propertyData) {
    try {
      const insights = {
        investmentScore: 0,
        areaPopularity: 0,
        priceTrend: 'stable',
        recommendationLabel: 'fair_price',
        estimatedMonthlyRent: 0,
        rentalYield: 0,
        pricePerSqm: 0
      };

      insights.pricePerSqm = propertyData.price / propertyData.area;
      
      insights.areaPopularity = this.calculateAreaPopularity(propertyData.location);
      
      insights.investmentScore = this.calculateInvestmentScore(propertyData, insights);
      
      insights.priceTrend = await this.calculatePriceTrend(propertyData);
      
      insights.recommendationLabel = this.getRecommendationLabel(propertyData, insights);
      
      insights.estimatedMonthlyRent = this.estimateMonthlyRent(propertyData, insights);
      
      insights.rentalYield = this.calculateRentalYield(propertyData, insights);

      return insights;
    } catch (error) {
      logger.error('Error generating AI insights:', error);
      return this.getDefaultInsights();
    }
  }

  calculateAreaPopularity(propertyData) {
    const address = (propertyData.location.address + ' ' + propertyData.location.city).toLowerCase();
    
    for (const [area, score] of Object.entries(this.areaPopularityScores)) {
      if (address.includes(area)) {
        return score;
      }
    }
    
    const city = propertyData.location.city.toLowerCase();
    const cityScores = {
      'lagos': 85,
      'abuja': 82,
      'port harcourt': 78,
      'kano': 72,
      'ibadan': 68,
      'benin city': 65,
      'kaduna': 63,
      'enugu': 61,
      'oyo': 59,
      'akwa ibom': 58
    };
    
    return cityScores[city] || 50;
  }

  calculateInvestmentScore(propertyData, insights) {
    let score = 50;
    
    const priceScore = this.calculatePriceScore(propertyData, insights);
    score = (score + priceScore) / 2;
    
    const popularityScore = insights.areaPopularity;
    score = (score * 0.7) + (popularityScore * 0.3);
    
    const conditionScore = this.getConditionScore(propertyData.condition);
    score = (score * 0.8) + (conditionScore * 0.2);
    
    const ageScore = this.getAgeScore(propertyData.yearBuilt);
    score = (score * 0.9) + (ageScore * 0.1);
    
    const typeScore = this.getPropertyTypeScore(propertyData.propertyType);
    score = (score * 0.85) + (typeScore * 0.15);
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  calculatePriceScore(propertyData, insights) {
    const city = propertyData.location.city.toLowerCase();
    const priceRanges = this.priceRanges[city] || this.priceRanges.default;
    
    const pricePerSqm = insights.pricePerSqm;
    
    if (pricePerSqm < priceRanges.low / propertyData.area) {
      return 85;
    } else if (pricePerSqm < priceRanges.medium / propertyData.area) {
      return 75;
    } else if (pricePerSqm < priceRanges.high / propertyData.area) {
      return 65;
    } else {
      return 45;
    }
  }

  getConditionScore(condition) {
    const scores = {
      'new': 90,
      'excellent': 85,
      'good': 70,
      'fair': 55,
      'needs_renovation': 35
    };
    
    return scores[condition] || 50;
  }

  getAgeScore(yearBuilt) {
    if (!yearBuilt) return 50;
    
    const currentYear = new Date().getFullYear();
    const age = currentYear - yearBuilt;
    
    if (age <= 2) return 85;
    if (age <= 5) return 80;
    if (age <= 10) return 70;
    if (age <= 20) return 60;
    if (age <= 30) return 45;
    return 30;
  }

  getPropertyTypeScore(propertyType) {
    const scores = {
      'apartment': 75,
      'house': 80,
      'villa': 85,
      'condo': 78,
      'townhouse': 76,
      'land': 65,
      'commercial': 70
    };
    
    return scores[propertyType] || 60;
  }

  async calculatePriceTrend(propertyData) {
    try {
      const city = propertyData.location.city;
      const propertyType = propertyData.propertyType;
      
      const similarProperties = await Property.find({
        'location.city': city,
        propertyType: propertyType,
        isActive: true,
        createdAt: {
          $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        }
      }).sort({ createdAt: 1 });
      
      if (similarProperties.length < 10) {
        return 'stable';
      }
      
      const halfPoint = Math.floor(similarProperties.length / 2);
      const firstHalf = similarProperties.slice(0, halfPoint);
      const secondHalf = similarProperties.slice(halfPoint);
      
      const firstHalfAvg = firstHalf.reduce((sum, p) => sum + p.price, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((sum, p) => sum + p.price, 0) / secondHalf.length;
      
      const changePercent = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
      
      if (changePercent > 5) return 'rising';
      if (changePercent < -5) return 'declining';
      return 'stable';
      
    } catch (error) {
      logger.error('Error calculating price trend:', error);
      return 'stable';
    }
  }

  getRecommendationLabel(propertyData, insights) {
    const score = insights.investmentScore;
    const pricePerSqm = insights.pricePerSqm;
    const city = propertyData.location.city.toLowerCase();
    const priceRanges = this.priceRanges[city] || this.priceRanges.default;
    
    if (score >= 85) {
      return 'best_deal';
    } else if (score >= 70) {
      return 'good_value';
    } else if (score >= 50) {
      return 'fair_price';
    } else {
      return 'overpriced';
    }
  }

  estimateMonthlyRent(propertyData, insights) {
    const city = propertyData.location.city.toLowerCase();
    const baseRentalYield = {
      'lagos': 0.08,
      'abuja': 0.07,
      'port harcourt': 0.09,
      'kano': 0.10,
      'ibadan': 0.11,
      'default': 0.09
    };
    
    const yieldRate = baseRentalYield[city] || baseRentalYield.default;
    
    const popularityMultiplier = insights.areaPopularity / 100;
    const conditionMultiplier = this.getConditionMultiplier(propertyData.condition);
    
    const adjustedYield = yieldRate * popularityMultiplier * conditionMultiplier;
    
    const monthlyRent = (propertyData.price * adjustedYield) / 12;
    
    return Math.round(monthlyRent);
  }

  getConditionMultiplier(condition) {
    const multipliers = {
      'new': 1.2,
      'excellent': 1.15,
      'good': 1.0,
      'fair': 0.85,
      'needs_renovation': 0.7
    };
    
    return multipliers[condition] || 1.0;
  }

  calculateRentalYield(propertyData, insights) {
    if (insights.estimatedMonthlyRent === 0) return 0;
    
    const annualRent = insights.estimatedMonthlyRent * 12;
    const yieldRate = (annualRent / propertyData.price) * 100;
    
    return Math.round(yieldRate * 100) / 100;
  }

  getDefaultInsights() {
    return {
      investmentScore: 50,
      areaPopularity: 50,
      priceTrend: 'stable',
      recommendationLabel: 'fair_price',
      estimatedMonthlyRent: 0,
      rentalYield: 0,
      pricePerSqm: 0
    };
  }

  async updatePropertyInsights(propertyId) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }
      
      const insights = await this.generateInsights(property.toJSON());
      property.aiInsights = insights;
      
      await property.save();
      
      return insights;
    } catch (error) {
      logger.error('Error updating property insights:', error);
      throw error;
    }
  }

  async batchUpdateInsights(limit = 100) {
    try {
      const properties = await Property.find({
        isActive: true,
        'aiInsights.investmentScore': { $lt: 10 }
      }).limit(limit);
      
      const results = [];
      
      for (const property of properties) {
        try {
          const insights = await this.updatePropertyInsights(property._id);
          results.push({
            propertyId: property._id,
            success: true,
            insights
          });
        } catch (error) {
          results.push({
            propertyId: property._id,
            success: false,
            error: error.message
          });
        }
      }
      
      return results;
    } catch (error) {
      logger.error('Error in batch update insights:', error);
      throw error;
    }
  }

  getMarketAnalysis(city, propertyType) {
    const cityData = {
      lagos: {
        averagePricePerSqm: 250000,
        averageRentalYield: 8.5,
        marketTrend: 'rising',
        popularAreas: ['Ikoyi', 'Victoria Island', 'Lekki', 'Ajah']
      },
      abuja: {
        averagePricePerSqm: 180000,
        averageRentalYield: 7.2,
        marketTrend: 'stable',
        popularAreas: ['Maitama', 'Asokoro', 'Jabi', 'Wuse']
      },
      port_harcourt: {
        averagePricePerSqm: 120000,
        averageRentalYield: 9.1,
        marketTrend: 'rising',
        popularAreas: ['GRA', 'Rumuokoro', 'Trans Amadi']
      }
    };
    
    return cityData[city.toLowerCase()] || cityData.default;
  }
}

module.exports = new AIInsightsService();
