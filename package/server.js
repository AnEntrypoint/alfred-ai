import express from 'express';
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!', timestamp: new Date().toISOString() });
});

app.get('/test', (req, res) => {
  res.json({ status: 'success', endpoint: '/test' });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});