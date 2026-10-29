const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { registerUser, loginUser, adminLogin, googleAuth, getMe, updateMe } = require('../controllers/auth.controller');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/admin/login', adminLogin);
router.post('/google', googleAuth);
router.get('/me', verifyToken, getMe);
router.patch('/me', verifyToken, updateMe);

module.exports = router;
