const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+(\S+)$/i)
    : null;
  const token = match?.[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified; // Append decoded JWT payload { id, role } to request
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
};

module.exports = { verifyToken };
