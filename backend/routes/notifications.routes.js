const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { getMyNotifications, markNotificationRead } = require('../controllers/notifications.controller');

router.get('/my', verifyToken, getMyNotifications);
router.patch('/:id/read', verifyToken, markNotificationRead);

module.exports = router;
