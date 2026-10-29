const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const {
  createAvailability, getProviderAvailabilities, getProviderDayStatus,
  blockProviderDay, unblockProviderDay,
} = require('../controllers/availabilities.controller');

router.post('/', verifyToken, createAvailability);
router.get('/provider/day-status', verifyToken, getProviderDayStatus);
router.post('/provider/day/block', verifyToken, blockProviderDay);
router.post('/provider/day/unblock', verifyToken, unblockProviderDay);
router.get('/:provider_id', getProviderAvailabilities);

module.exports = router;
