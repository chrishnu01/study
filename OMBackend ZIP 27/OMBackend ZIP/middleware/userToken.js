const jwt = require('jsonwebtoken');
const User = require('../models/User');

const userToken = async (req, res, next) => {
  try {
    const tokenauth = req.headers.authorization;
    if (!tokenauth || !tokenauth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
    }

    const token = tokenauth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id || decoded.userId || decoded._id || decoded.user.id || decoded.user.userId || decoded.user._id);
       if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

    req.user = user;
    next();
  } catch (error) {
    console.error('🔥 Auth error:', error);
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports = userToken;