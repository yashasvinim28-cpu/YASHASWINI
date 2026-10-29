const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { getMyDashboard, getProviderDashboard } = require('../controllers/dashboard.controller');

router.get('/me', verifyToken, getMyDashboard);
router.get('/provider', verifyToken, getProviderDashboard);

module.exports = router;
