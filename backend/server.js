require('dotenv').config();
const { verifySupabaseSchema } = require('./config/supabase');

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'ClickNGo Backend API is active!' });
});


app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/services', require('./routes/services.routes'));
app.use('/api/availabilities', require('./routes/availabilities.routes'));
app.use('/api/bookings', require('./routes/bookings.routes'));
app.use('/api/reviews', require('./routes/reviews.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/payments', require('./routes/payments.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));



app.use((err, req, res, next) => {
  console.error('🔥 Global App Error:', err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

verifySupabaseSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`API Server running on ${PORT}`));
  })
  .catch((error) => {
    console.error(`Supabase startup check failed: ${error.message}`);
    process.exit(1);
  });
