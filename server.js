// server.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Connexion Postgres (Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Vérifier la connexion au démarrage
pool.connect()
  .then(client => {
    console.log('Connecté à la base Postgres Render');
    client.release();
  })
  .catch(err => {
    console.error('Erreur de connexion Postgres :', err);
  });

// Route test
app.get('/', (req, res) => {
  res.json({ message: 'API DAF opérationnelle' });
});

// Routes en attente de migration
app.get('/api/depenses', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.get('/api/depenses/:id', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.post('/api/depenses', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.get('/api/factures', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.get('/api/factures/:id', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.post('/api/factures', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.get('/api/validations', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.put('/api/validations/:id', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.get('/api/user/current', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.get('/api/dashboard/daf', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.get('/api/paie', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.post('/api/paie', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

// Serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur DAF en écoute sur port ${PORT}`);
});