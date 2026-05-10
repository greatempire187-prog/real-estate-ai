const { RateLimiterMemory } = require('rate-limiter-flexible');
const logger = require('../utils/logger');

const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  blockDuration: 60000,
});

const strictRateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 10,
  duration: 60000,
  blockDuration: 300000,
});

const authRateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 5,
  duration: 900000,
  blockDuration: 1800000,
});

const rateLimiterMiddleware = async (req, res, next) => {
  try {
    if (req.path.startsWith('/api/auth/')) {
      await authRateLimiter.consume(req.ip);
    } else if (req.path.startsWith('/api/admin/')) {
      await strictRateLimiter.consume(req.ip);
    } else {
      await rateLimiter.consume(req.ip);
    }
    next();
  } catch (rejRes) {
    const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
    
    logger.warn('Rate limit exceeded:', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      remainingPoints: rejRes.remainingPoints,
      msBeforeNext: rejRes.msBeforeNext
    });

    res.set('Retry-After', String(secs));
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: secs,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = rateLimiterMiddleware;
