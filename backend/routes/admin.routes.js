const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const {
  getAdminDashboard,
  getAdminServices,
  reviewService,
} = require('../controllers/admin.controller');

router.get('/dashboard', verifyToken, getAdminDashboard);
router.get('/services', verifyToken, getAdminServices);
router.patch('/services/:id/review', verifyToken, reviewService);

module.exports = router;
