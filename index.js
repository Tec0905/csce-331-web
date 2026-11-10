const express = require('express');
const path = require('path');
const pool = require('./db');
const kioskRoutes = require('./routes/kiosk');
const managerRoutes = require('./routes/manager');
const kitchenRoutes = require('./routes/kitchen');
 
const app = express();
const port = process.env.PORT || 3000;
 
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/kiosk', kioskRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/kitchen', kitchenRoutes);
 
// Test database connection
app.get('/api/db-test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
 
        res.json({
            status: 'connected',
            databaseTime: result.rows[0].now
        });
 
    } catch (error) {
        console.error('Database connection failed:', error);
 
        res.status(500).json({
            status: 'error',
            message: 'Database connection failed'
        });
    }
});
 
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
 
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});