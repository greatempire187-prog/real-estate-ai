const axios = require('axios');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const cron = require('node-cron');
const Property = require('../models/Property');
const Analytics = require('../models/Analytics');
const logger = require('../utils/logger');
const geocodingService = require('./geocodingService');
const aiInsightsService = require('./aiInsightsService');

class IngestionService {
  constructor() {
    this.io = null;
    this.isRunning = false;
    this.stats = {
      totalProcessed: 0,
      totalAdded: 0,
      totalUpdated: 0,
      totalErrors: 0,
      lastRun: null,
      runDuration: 0
    };
    this.sources = [
      {
        name: 'propertyguru_nigeria',
        type: 'api',
        url: 'https://api.propertyguru.com.ng/v1/listings',
        enabled: true
      },
      {
        name: 'nairaland_properties',
        type: 'scraping',
        url: 'https://www.nairaland.com/properties',
        enabled: true
      },
      {
        name: 'jiji_ng',
        type: 'scraping',
        url: 'https://jiji.ng/properties',
        enabled: true
      }
    ];
  }

  initialize(io) {
    this.io = io;
    
    logger.info('Initializing ingestion service...');
    
    cron.schedule('*/5 * * * *', async () => {
      if (!this.isRunning) {
        await this.runIngestion();
      }
    });
    
    setTimeout(() => {
      this.runIngestion();
    }, 5000);
  }

  async runIngestion() {
    if (this.isRunning) {
      logger.warn('Ingestion already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      logger.info('Starting property ingestion...');
      
      const results = await Promise.allSettled(
        this.sources
          .filter(source => source.enabled)
          .map(source => this.processSource(source))
      );
      
      let totalProcessed = 0;
      let totalAdded = 0;
      let totalUpdated = 0;
      let totalErrors = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          totalProcessed += result.value.processed;
          totalAdded += result.value.added;
          totalUpdated += result.value.updated;
        } else {
          totalErrors++;
          logger.error(`Source ${this.sources[index].name} failed:`, result.reason);
        }
      });
      
      this.stats = {
        totalProcessed,
        totalAdded,
        totalUpdated,
        totalErrors,
        lastRun: new Date(),
        runDuration: Date.now() - startTime
      };
      
      await this.updateAnalytics();
      
      if (this.io) {
        this.io.emit('ingestion_complete', {
          stats: this.stats,
          timestamp: new Date()
        });
      }
      
      logger.info(`Ingestion completed. Processed: ${totalProcessed}, Added: ${totalAdded}, Updated: ${totalUpdated}, Errors: ${totalErrors}`);
      
    } catch (error) {
      logger.error('Ingestion service error:', error);
      this.stats.totalErrors++;
    } finally {
      this.isRunning = false;
    }
  }

  async processSource(source) {
    const startTime = Date.now();
    let processed = 0;
    let added = 0;
    let updated = 0;
    
    try {
      let properties = [];
      
      if (source.type === 'api') {
        properties = await this.fetchFromAPI(source);
      } else if (source.type === 'scraping') {
        properties = await this.scrapeFromWebsite(source);
      }
      
      const maxProperties = parseInt(process.env.MAX_PROPERTIES_PER_RUN) || 50;
      properties = properties.slice(0, maxProperties);
      
      for (const propertyData of properties) {
        try {
          processed++;
          const result = await this.processProperty(propertyData, source.name);
          
          if (result.isNew) {
            added++;
            if (this.io) {
              this.io.emit('new_property', {
                property: result.property,
                source: source.name,
                timestamp: new Date()
              });
              
              this.io.emit('notification', {
                type: 'new_listing',
                title: 'New Property Listed',
                message: `${result.property.title} in ${result.property.location.city} - ₦${result.property.price.toLocaleString()}`,
                data: result.property
              });
            }
          } else if (result.isUpdated) {
            updated++;
          }
          
          await this.delay(100);
          
        } catch (error) {
          logger.error(`Error processing property from ${source.name}:`, error);
        }
      }
      
      logger.info(`Source ${source.name} completed in ${Date.now() - startTime}ms. Processed: ${processed}, Added: ${added}, Updated: ${updated}`);
      
    } catch (error) {
      logger.error(`Error processing source ${source.name}:`, error);
    }
    
    return { processed, added, updated };
  }

  async fetchFromAPI(source) {
    try {
      const response = await axios.get(source.url, {
        headers: {
          'Authorization': `Bearer ${process.env.PROPERTY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      return this.normalizeAPIData(response.data, source.name);
    } catch (error) {
      logger.error(`API fetch error for ${source.name}:`, error);
      return [];
    }
  }

  async scrapeFromWebsite(source) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      await page.goto(source.url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      const content = await page.content();
      const $ = cheerio.load(content);
      
      return this.normalizeScrapedData($, source.name);
      
    } catch (error) {
      logger.error(`Scraping error for ${source.name}:`, error);
      return [];
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  normalizeAPIData(data, source) {
    const properties = [];
    
    if (Array.isArray(data.listings || data.properties || data)) {
      const listings = data.listings || data.properties || data;
      
      for (const item of listings) {
        const property = {
          title: item.title || item.property_name || 'Unknown Property',
          description: item.description || item.details || 'No description available',
          price: this.parsePrice(item.price || item.amount || 0),
          currency: item.currency || 'NGN',
          propertyType: this.normalizePropertyType(item.property_type || item.type),
          bedrooms: parseInt(item.bedrooms || item.beds) || 0,
          bathrooms: parseInt(item.bathrooms || item.baths) || 0,
          area: parseFloat(item.area || item.size || item.square_meters) || 0,
          areaUnit: item.area_unit || 'sqm',
          location: {
            address: item.address || item.location || 'Unknown Address',
            city: item.city || 'Unknown City',
            state: item.state || 'Unknown State',
            country: item.country || 'Nigeria',
            coordinates: null
          },
          images: this.normalizeImages(item.images || item.photos || []),
          features: item.features || [],
          amenities: item.amenities || [],
          yearBuilt: parseInt(item.year_built) || null,
          condition: item.condition || 'good',
          status: item.status || 'available',
          listingType: this.normalizeListingType(item.listing_type || item.type),
          source: {
            platform: source,
            url: item.url || item.link,
            listingId: item.id || item.listing_id,
            scrapedAt: new Date()
          }
        };
        
        properties.push(property);
      }
    }
    
    return properties;
  }

  normalizeScrapedData($, source) {
    const properties = [];
    
    const listings = this.extractListingsFromHTML($, source);
    
    for (const listing of listings) {
      const property = {
        title: listing.title || 'Unknown Property',
        description: listing.description || 'No description available',
        price: this.parsePrice(listing.price || 0),
        currency: 'NGN',
        propertyType: this.normalizePropertyType(listing.propertyType || listing.type),
        bedrooms: parseInt(listing.bedrooms) || 0,
        bathrooms: parseInt(listing.bathrooms) || 0,
        area: parseFloat(listing.area) || 0,
        areaUnit: 'sqm',
        location: {
          address: listing.address || listing.location || 'Unknown Address',
          city: listing.city || 'Unknown City',
          state: listing.state || 'Unknown State',
          country: 'Nigeria',
          coordinates: null
        },
        images: this.normalizeImages(listing.images || []),
        features: listing.features || [],
        amenities: listing.amenities || [],
        yearBuilt: null,
        condition: 'good',
        status: 'available',
        listingType: this.normalizeListingType(listing.listingType),
        source: {
          platform: source,
          url: listing.url,
          listingId: listing.id,
          scrapedAt: new Date()
        }
      };
      
      properties.push(property);
    }
    
    return properties;
  }

  extractListingsFromHTML($, source) {
    const listings = [];
    
    if (source === 'nairaland_properties') {
      $('.topic').each((index, element) => {
        const $topic = $(element);
        const title = $topic.find('.title a').text().trim();
        const link = $topic.find('.title a').attr('href');
        const description = $topic.find('.originalposter').text().trim();
        
        if (title && link) {
          listings.push({
            title,
            url: `https://www.nairaland.com${link}`,
            description,
            price: this.extractPriceFromText(title + ' ' + description),
            propertyType: this.extractPropertyTypeFromText(title)
          });
        }
      });
    } else if (source === 'jiji_ng') {
      $('.b-list-advert').each((index, element) => {
        const $advert = $(element);
        const title = $advert.find('.b-advert-title').text().trim();
        const link = $advert.find('a').attr('href');
        const price = $advert.find('.b-advert-price').text().trim();
        const location = $advert.find('.b-advert-region').text().trim();
        
        if (title && link) {
          listings.push({
            title,
            url: `https://jiji.ng${link}`,
            price,
            location,
            description: title
          });
        }
      });
    }
    
    return listings;
  }

  async processProperty(propertyData, source) {
    try {
      if (!propertyData.location.coordinates) {
        const coordinates = await geocodingService.geocodeAddress(
          `${propertyData.location.address}, ${propertyData.location.city}, ${propertyData.location.state}`
        );
        
        if (coordinates) {
          propertyData.location.coordinates = {
            type: 'Point',
            coordinates: [coordinates.lng, coordinates.lat]
          };
        }
      }
      
      const existingProperty = await Property.findOne({
        'source.platform': source,
        'source.listingId': propertyData.source.listingId
      });
      
      if (existingProperty) {
        const hasChanges = this.hasSignificantChanges(existingProperty, propertyData);
        
        if (hasChanges) {
          Object.assign(existingProperty, propertyData);
          existingProperty.source.scrapedAt = new Date();
          await existingProperty.save();
          
          return { isNew: false, isUpdated: true, property: existingProperty };
        }
        
        return { isNew: false, isUpdated: false, property: existingProperty };
      }
      
      const aiInsights = await aiInsightsService.generateInsights(propertyData);
      propertyData.aiInsights = aiInsights;
      
      const newProperty = new Property(propertyData);
      await newProperty.save();
      
      return { isNew: true, isUpdated: false, property: newProperty };
      
    } catch (error) {
      logger.error('Error processing property:', error);
      throw error;
    }
  }

  hasSignificantChanges(existing, newData) {
    return (
      existing.price !== newData.price ||
      existing.status !== newData.status ||
      existing.location.address !== newData.location.address
    );
  }

  parsePrice(priceText) {
    if (typeof priceText === 'number') return priceText;
    
    const cleaned = priceText.toString().replace(/[^\d.]/g, '');
    const parsed = parseFloat(cleaned);
    
    if (priceText.toString().toLowerCase().includes('million') || 
        priceText.toString().toLowerCase().includes('m')) {
      return parsed * 1000000;
    }
    
    if (priceText.toString().toLowerCase().includes('thousand') || 
        priceText.toString().toLowerCase().includes('k')) {
      return parsed * 1000;
    }
    
    return parsed || 0;
  }

  extractPriceFromText(text) {
    const priceMatch = text.match(/₦?[\d,]+(?:\.\d+)?\s*(million|m|thousand|k)?/i);
    return priceMatch ? priceMatch[0] : '0';
  }

  extractPropertyTypeFromText(text) {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('apartment') || lowerText.includes('flat')) return 'apartment';
    if (lowerText.includes('house') || lowerText.includes('home')) return 'house';
    if (lowerText.includes('land')) return 'land';
    if (lowerText.includes('commercial') || lowerText.includes('office')) return 'commercial';
    if (lowerText.includes('villa')) return 'villa';
    
    return 'apartment';
  }

  normalizePropertyType(type) {
    if (!type) return 'apartment';
    
    const normalized = type.toString().toLowerCase();
    
    if (normalized.includes('apartment') || normalized.includes('flat')) return 'apartment';
    if (normalized.includes('house') || normalized.includes('home')) return 'house';
    if (normalized.includes('land')) return 'land';
    if (normalized.includes('commercial') || normalized.includes('office')) return 'commercial';
    if (normalized.includes('villa')) return 'villa';
    if (normalized.includes('condo')) return 'condo';
    if (normalized.includes('townhouse')) return 'townhouse';
    
    return 'apartment';
  }

  normalizeListingType(type) {
    if (!type) return 'sale';
    
    const normalized = type.toString().toLowerCase();
    
    if (normalized.includes('rent') || normalized.includes('lease')) return 'rent';
    if (normalized.includes('sale') || normalized.includes('buy')) return 'sale';
    if (normalized.includes('lease')) return 'lease';
    
    return 'sale';
  }

  normalizeImages(images) {
    if (!Array.isArray(images)) return [];
    
    return images.map((img, index) => ({
      url: typeof img === 'string' ? img : img.url || img.src,
      caption: img.caption || '',
      isPrimary: index === 0
    })).filter(img => img.url);
  }

  async updateAnalytics() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let analytics = await Analytics.getDailyStats(today);
      
      if (!analytics) {
        analytics = new Analytics({
          date: today,
          metrics: {}
        });
      }
      
      analytics.metrics.totalListings = await Property.countDocuments({ isActive: true });
      analytics.metrics.newListings = this.stats.totalAdded;
      analytics.metrics.activeListings = await Property.countDocuments({ 
        isActive: true, 
        status: 'available' 
      });
      analytics.metrics.soldListings = await Property.countDocuments({ 
        status: 'sold' 
      });
      
      const priceStats = await Property.aggregate([
        { $match: { isActive: true, status: 'available' } },
        { $group: {
          _id: null,
          avgPrice: { $avg: '$price' },
          medianPrice: { $median: { input: '$price', method: 'approximate' } }
        }}
      ]);
      
      if (priceStats.length > 0) {
        analytics.metrics.averagePrice = priceStats[0].avgPrice;
        analytics.metrics.medianPrice = priceStats[0].medianPrice;
      }
      
      analytics.metrics.ingestionRuns = (analytics.metrics.ingestionRuns || 0) + 1;
      analytics.metrics.propertiesScraped = this.stats.totalProcessed;
      
      await analytics.save();
      
    } catch (error) {
      logger.error('Error updating analytics:', error);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      sources: this.sources.map(source => ({
        name: source.name,
        type: source.type,
        enabled: source.enabled
      }))
    };
  }

  async toggleSource(sourceName, enabled) {
    const source = this.sources.find(s => s.name === sourceName);
    if (source) {
      source.enabled = enabled;
      logger.info(`Source ${sourceName} ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }
    return false;
  }
}

module.exports = new IngestionService();
