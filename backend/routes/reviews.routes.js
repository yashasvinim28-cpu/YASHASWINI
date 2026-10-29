const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { createReview, getServiceReviews, getMyPendingReviews } = require('../controllers/reviews.controller');

router.post('/', verifyToken, createReview);
router.get('/service/:serviceId', getServiceReviews);
router.get('/pending/me', verifyToken, getMyPendingReviews);

module.exports = router;
