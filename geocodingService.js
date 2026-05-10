const axios = require('axios');
const logger = require('../utils/logger');

class GeocodingService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
  }

  async geocodeAddress(address) {
    const cacheKey = address.toLowerCase().trim();
    
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    try {
      const coordinates = await this.getCoordinatesFromOpenStreetMap(address);
      
      if (coordinates) {
        this.cache.set(cacheKey, {
          data: coordinates,
          timestamp: Date.now()
        });
        
        return coordinates;
      }
      
      return await this.getCoordinatesFromNominatim(address);
      
    } catch (error) {
      logger.error('Geocoding error:', error);
      
      return this.getFallbackCoordinates(address);
    }
  }

  async getCoordinatesFromOpenStreetMap(address) {
    try {
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: address,
          format: 'json',
          limit: 1,
          countrycodes: 'ng'
        },
        headers: {
          'User-Agent': 'GreatEmpireRealEstate/1.0'
        },
        timeout: 10000
      });

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        return {
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          address: result.display_name
        };
      }

      return null;
    } catch (error) {
      logger.error('OpenStreetMap geocoding error:', error);
      return null;
    }
  }

  async getCoordinatesFromNominatim(address) {
    try {
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: address,
          format: 'json',
          limit: 1,
          country: 'Nigeria'
        },
        headers: {
          'User-Agent': 'GreatEmpireRealEstate/1.0'
        },
        timeout: 10000
      });

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        return {
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          address: result.display_name
        };
      }

      return null;
    } catch (error) {
      logger.error('Nominatim geocoding error:', error);
      return null;
    }
  }

  getFallbackCoordinates(address) {
    const cityCoordinates = {
      'lagos': { lat: 6.5244, lng: 3.3792 },
      'abuja': { lat: 9.0579, lng: 7.4951 },
      'kano': { lat: 11.9804, lng: 8.5368 },
      'ibadan': { lat: 7.3775, lng: 3.9470 },
      'port harcourt': { lat: 4.8156, lng: 7.0498 },
      'benin city': { lat: 6.3350, lng: 5.6037 },
      'maiduguri': { lat: 11.8311, lng: 13.1110 },
      'zaria': { lat: 11.1108, lng: 7.7227 },
      'aba': { lat: 5.1333, lng: 7.3667 },
      'jos': { lat: 9.9285, lng: 8.8947 },
      'enugu': { lat: 6.4419, lng: 7.5021 },
      'ile-ife': { lat: 7.4855, lng: 4.5452 },
      'akure': { lat: 7.2526, lng: 5.1958 },
      'ilorin': { lat: 8.4966, lng: 4.5421 },
      'owo': { lat: 7.1930, lng: 5.5869 },
      'sokoto': { lat: 13.0609, lng: 5.2390 },
      'calabar': { lat: 4.9546, lng: 8.3255 },
      'warri': { lat: 5.5472, lng: 5.7579 },
      'umuahia': { lat: 5.5335, lng: 7.4951 },
      'kaduna': { lat: 10.5222, lng: 7.4374 }
    };

    const lowerAddress = address.toLowerCase();
    
    for (const [city, coords] of Object.entries(cityCoordinates)) {
      if (lowerAddress.includes(city)) {
        logger.info(`Using fallback coordinates for ${city}:`, coords);
        return {
          ...coords,
          address: `${city}, Nigeria`
        };
      }
    }

    logger.warn('No coordinates found for address:', address);
    return {
      lat: 9.0765,
      lng: 7.3986,
      address: 'Nigeria'
    };
  }

  async reverseGeocode(lat, lng) {
    try {
      const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: {
          lat,
          lon: lng,
          format: 'json'
        },
        headers: {
          'User-Agent': 'GreatEmpireRealEstate/1.0'
        },
        timeout: 10000
      });

      if (response.data) {
        return {
          address: response.data.display_name,
          city: this.extractCity(response.data.address),
          state: this.extractState(response.data.address),
          country: response.data.address.country || 'Nigeria'
        };
      }

      return null;
    } catch (error) {
      logger.error('Reverse geocoding error:', error);
      return null;
    }
  }

  extractCity(address) {
    if (!address) return null;
    
    return address.city || address.town || address.village || address.suburb || null;
  }

  extractState(address) {
    if (!address) return null;
    
    return address.state || address.region || null;
  }

  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  isPointInRadius(centerLat, centerLng, pointLat, pointLng, radiusKm) {
    const distance = this.calculateDistance(centerLat, centerLng, pointLat, pointLng);
    return distance <= radiusKm;
  }

  getBoundingBox(lat, lng, radiusKm) {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.cos(this.toRadians(lat)));
    
    return {
      minLat: lat - latDelta,
      maxLat: lat + latDelta,
      minLng: lng - lngDelta,
      maxLng: lng + lngDelta
    };
  }

  clearCache() {
    this.cache.clear();
    logger.info('Geocoding cache cleared');
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = new GeocodingService();
