import express from 'express';
import googleCalendarRouter from './googleCalendar';

const app = express();

app.use(express.json());
app.use('/api/google-calendar', googleCalendarRouter);

app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'LawBandit Calendar API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      upload: '/api/upload (POST)',
      googleCalendar: '/api/google-calendar'
    }
  });
});

export default app;