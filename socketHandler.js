const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const Property = require('../models/Property');
const Analytics = require('../models/Analytics');

class SocketHandler {
  constructor() {
    this.connectedUsers = new Map();
    this.userSockets = new Map();
    this.roomUsers = new Map();
  }

  handle(io) {
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (token) {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          socket.userId = decoded.id;
          socket.userRole = decoded.role;
        }
        
        next();
      } catch (error) {
        next();
      }
    });

    io.on('connection', (socket) => {
      logger.info(`User connected: ${socket.id}`);
      
      this.connectedUsers.set(socket.id, {
        id: socket.id,
        userId: socket.userId || null,
        userRole: socket.userRole || 'guest',
        connectedAt: new Date(),
        lastActivity: new Date()
      });

      this.updateConnectedUsersCount(io);

      socket.on('join_room', (data) => {
        this.handleJoinRoom(socket, data, io);
      });

      socket.on('leave_room', (data) => {
        this.handleLeaveRoom(socket, data, io);
      });

      socket.on('search_properties', (data) => {
        this.handlePropertySearch(socket, data, io);
      });

      socket.on('track_property_view', (data) => {
        this.handlePropertyView(socket, data, io);
      });

      socket.on('contact_agent', (data) => {
        this.handleAgentContact(socket, data, io);
      });

      socket.on('save_property', (data) => {
        this.handleSaveProperty(socket, data, io);
      });

      socket.on('get_live_stats', () => {
        this.handleLiveStats(socket, io);
      });

      socket.on('subscribe_location', (data) => {
        this.handleLocationSubscription(socket, data, io);
      });

      socket.on('unsubscribe_location', (data) => {
        this.handleLocationUnsubscription(socket, data, io);
      });

      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date() });
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket, io);
      });

      socket.on('error', (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
      });

      this.sendWelcomeMessage(socket);
    });

    this.setupPeriodicUpdates(io);
  }

  handleJoinRoom(socket, data, io) {
    const { room } = data;
    
    if (!room) {
      socket.emit('error', { message: 'Room name is required' });
      return;
    }

    socket.join(room);
    
    if (!this.roomUsers.has(room)) {
      this.roomUsers.set(room, new Set());
    }
    
    this.roomUsers.get(room).add(socket.id);
    
    this.updateUserActivity(socket.id);
    
    socket.emit('room_joined', { room, timestamp: new Date() });
    
    logger.info(`User ${socket.id} joined room: ${room}`);
  }

  handleLeaveRoom(socket, data, io) {
    const { room } = data;
    
    if (!room) {
      socket.emit('error', { message: 'Room name is required' });
      return;
    }

    socket.leave(room);
    
    if (this.roomUsers.has(room)) {
      this.roomUsers.get(room).delete(socket.id);
      
      if (this.roomUsers.get(room).size === 0) {
        this.roomUsers.delete(room);
      }
    }
    
    this.updateUserActivity(socket.id);
    
    socket.emit('room_left', { room, timestamp: new Date() });
    
    logger.info(`User ${socket.id} left room: ${room}`);
  }

  async handlePropertySearch(socket, data, io) {
    try {
      this.updateUserActivity(socket.id);
      
      const {
        query,
        filters,
        page = 1,
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = data;

      const searchQuery = this.buildSearchQuery(query, filters);
      
      const properties = await Property.find(searchQuery)
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('source');

      const total = await Property.countDocuments(searchQuery);

      socket.emit('search_results', {
        properties,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Property search error:', error);
      socket.emit('error', { message: 'Search failed' });
    }
  }

  async handlePropertyView(socket, data, io) {
    try {
      const { propertyId } = data;
      
      if (!propertyId) {
        socket.emit('error', { message: 'Property ID is required' });
        return;
      }

      const property = await Property.findById(propertyId);
      if (!property) {
        socket.emit('error', { message: 'Property not found' });
        return;
      }

      await property.incrementViews();
      
      this.updateUserActivity(socket.id);
      
      socket.emit('property_viewed', {
        propertyId,
        views: property.views,
        timestamp: new Date()
      });

      if (property.views % 10 === 0) {
        io.to('admin_room').emit('property_milestone', {
          propertyId,
          propertyTitle: property.title,
          views: property.views,
          timestamp: new Date()
        });
      }

    } catch (error) {
      logger.error('Property view error:', error);
      socket.emit('error', { message: 'Failed to record view' });
    }
  }

  async handleAgentContact(socket, data, io) {
    try {
      const { propertyId, message } = data;
      
      if (!propertyId || !message) {
        socket.emit('error', { message: 'Property ID and message are required' });
        return;
      }

      const property = await Property.findById(propertyId);
      if (!property) {
        socket.emit('error', { message: 'Property not found' });
        return;
      }

      await property.incrementContacts();
      
      this.updateUserActivity(socket.id);
      
      socket.emit('agent_contacted', {
        propertyId,
        contacts: property.contacts,
        timestamp: new Date()
      });

      io.to('admin_room').emit('new_contact', {
        propertyId,
        propertyTitle: property.title,
        message,
        userId: socket.userId,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Agent contact error:', error);
      socket.emit('error', { message: 'Failed to contact agent' });
    }
  }

  async handleSaveProperty(socket, data, io) {
    try {
      const { propertyId, action } = data;
      
      if (!propertyId || !action) {
        socket.emit('error', { message: 'Property ID and action are required' });
        return;
      }

      if (!['save', 'unsave'].includes(action)) {
        socket.emit('error', { message: 'Invalid action' });
        return;
      }

      const property = await Property.findById(propertyId);
      if (!property) {
        socket.emit('error', { message: 'Property not found' });
        return;
      }

      this.updateUserActivity(socket.id);
      
      socket.emit('property_saved', {
        propertyId,
        action,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Save property error:', error);
      socket.emit('error', { message: 'Failed to save property' });
    }
  }

  async handleLiveStats(socket, io) {
    try {
      const stats = {
        connectedUsers: this.connectedUsers.size,
        totalProperties: await Property.countDocuments({ isActive: true }),
        newPropertiesToday: await Property.countDocuments({
          createdAt: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }),
        activeProperties: await Property.countDocuments({ 
          isActive: true, 
          status: 'available' 
        }),
        averagePrice: await Property.aggregate([
          { $match: { isActive: true, status: 'available' } },
          { $group: { _id: null, avgPrice: { $avg: '$price' } } }
        ]).then(result => result[0]?.avgPrice || 0)
      };

      socket.emit('live_stats', {
        ...stats,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Live stats error:', error);
      socket.emit('error', { message: 'Failed to fetch stats' });
    }
  }

  async handleLocationSubscription(socket, data, io) {
    try {
      const { coordinates, radius } = data;
      
      if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
        socket.emit('error', { message: 'Valid coordinates are required' });
        return;
      }

      const roomName = `location_${coordinates[0]}_${coordinates[1]}_${radius || 10}`;
      
      socket.join(roomName);
      
      if (!this.roomUsers.has(roomName)) {
        this.roomUsers.set(roomName, new Set());
      }
      
      this.roomUsers.get(roomName).add(socket.id);
      
      this.updateUserActivity(socket.id);
      
      socket.emit('location_subscribed', {
        room: roomName,
        coordinates,
        radius: radius || 10,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Location subscription error:', error);
      socket.emit('error', { message: 'Failed to subscribe to location' });
    }
  }

  handleLocationUnsubscription(socket, data, io) {
    try {
      const { coordinates, radius } = data;
      
      if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
        socket.emit('error', { message: 'Valid coordinates are required' });
        return;
      }

      const roomName = `location_${coordinates[0]}_${coordinates[1]}_${radius || 10}`;
      
      socket.leave(roomName);
      
      if (this.roomUsers.has(roomName)) {
        this.roomUsers.get(roomName).delete(socket.id);
        
        if (this.roomUsers.get(roomName).size === 0) {
          this.roomUsers.delete(roomName);
        }
      }
      
      this.updateUserActivity(socket.id);
      
      socket.emit('location_unsubscribed', {
        room: roomName,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Location unsubscription error:', error);
      socket.emit('error', { message: 'Failed to unsubscribe from location' });
    }
  }

  handleDisconnect(socket, io) {
    logger.info(`User disconnected: ${socket.id}`);
    
    this.connectedUsers.delete(socket.id);
    
    for (const [room, users] of this.roomUsers.entries()) {
      users.delete(socket.id);
      
      if (users.size === 0) {
        this.roomUsers.delete(room);
      }
    }
    
    this.updateConnectedUsersCount(io);
  }

  sendWelcomeMessage(socket) {
    socket.emit('welcome', {
      message: 'Welcome to Great Empire Real-Estate Platform',
      features: [
        'Real-time property updates',
        'Live search and filtering',
        'Interactive map support',
        'AI-powered insights'
      ],
      timestamp: new Date()
    });
  }

  buildSearchQuery(query, filters) {
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
        { 'location.state': { $regex: query, $options: 'i' } }
      ];
    }

    if (filters) {
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
    }

    return searchQuery;
  }

  updateUserActivity(socketId) {
    const user = this.connectedUsers.get(socketId);
    if (user) {
      user.lastActivity = new Date();
    }
  }

  updateConnectedUsersCount(io) {
    io.emit('connected_users_update', {
      count: this.connectedUsers.size,
      timestamp: new Date()
    });
  }

  setupPeriodicUpdates(io) {
    setInterval(async () => {
      try {
        const stats = await this.getLiveStats();
        io.emit('periodic_stats_update', {
          ...stats,
          timestamp: new Date()
        });
      } catch (error) {
        logger.error('Periodic stats update error:', error);
      }
    }, 30000);

    setInterval(() => {
      this.cleanupInactiveUsers();
    }, 60000);
  }

  async getLiveStats() {
    return {
      connectedUsers: this.connectedUsers.size,
      totalProperties: await Property.countDocuments({ isActive: true }),
      newPropertiesToday: await Property.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      activeProperties: await Property.countDocuments({ 
        isActive: true, 
        status: 'available' 
      }),
      averagePrice: await Property.aggregate([
        { $match: { isActive: true, status: 'available' } },
        { $group: { _id: null, avgPrice: { $avg: '$price' } } }
      ]).then(result => result[0]?.avgPrice || 0)
    };
  }

  cleanupInactiveUsers() {
    const now = new Date();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
    
    for (const [socketId, user] of this.connectedUsers.entries()) {
      if (now - user.lastActivity > inactiveThreshold) {
        this.connectedUsers.delete(socketId);
        logger.info(`Cleaned up inactive user: ${socketId}`);
      }
    }
  }

  broadcastToRoom(room, event, data) {
    if (this.roomUsers.has(room)) {
      const usersInRoom = Array.from(this.roomUsers.get(room));
      logger.info(`Broadcasting ${event} to room ${room} with ${usersInRoom.length} users`);
    }
  }

  getConnectedUsers() {
    return Array.from(this.connectedUsers.values());
  }

  getRoomUsers(room) {
    return this.roomUsers.has(room) ? Array.from(this.roomUsers.get(room)) : [];
  }
}

module.exports = new SocketHandler();
