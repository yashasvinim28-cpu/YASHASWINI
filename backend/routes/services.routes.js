const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const {
  createService,
  getServices,
  getMyServices,
  getMyServiceById,
  getServiceById,
  updateService,
  deleteService,
  getServiceCategories
} = require('../controllers/services.controller');

router.post('/', verifyToken, createService);
router.get('/categories', getServiceCategories);
router.get('/my', verifyToken, getMyServices); // MUST be before /:id
router.get('/my/:id', verifyToken, getMyServiceById);
router.get('/:id', getServiceById);
router.get('/', getServices);
router.delete('/:id', verifyToken, deleteService); // Delete service (soft delete)
router.patch('/:id', verifyToken, updateService); // Update service

module.exports = router;
