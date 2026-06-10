const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes    = require('./routes/auth');
const analyzeRoutes = require('./routes/analyze');
const recordsRoutes = require('./routes/records');
const usersRoutes   = require('./routes/users');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();

// ── 미들웨어 ──
const _corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({ origin: _corsOrigins }));
app.use(express.json());
app.use('/api/', apiLimiter);

// ── 정적 파일 서빙 ──
app.use(express.static(path.join(__dirname, '../../frontend/html')));
app.use('/src', express.static(path.join(__dirname, '../../frontend/src')));

// ── 루트 → index.html ──
app.get('/', (req, res) => res.redirect('/index.html'));

// ── 라우터 연결 ──
app.use('/api/auth',    authRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/users',   usersRoutes);

// ── 서버 실행 ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중 → http://localhost:${PORT}`);
});
