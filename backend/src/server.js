const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes    = require('./routes/auth');
const analyzeRoutes = require('./routes/analyze');
const recordsRoutes = require('./routes/records');

const app = express();

// ── 미들웨어 ──
app.use(cors());
app.use(express.json());

// ── 정적 파일 서빙 ──
app.use(express.static(path.join(__dirname, '../../frontend/html')));
app.use('/src', express.static(path.join(__dirname, '../../frontend/src')));

// ── 루트 → index.html ──
app.get('/', (req, res) => res.redirect('/index.html'));

// ── 라우터 연결 ──
app.use('/api/auth',    authRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/records', recordsRoutes);

// ── 서버 실행 ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중 → http://localhost:${PORT}`);
});
