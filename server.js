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

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        role TEXT NOT NULL,
        email TEXT,
        mot_de_passe_hash TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS depenses (
        id SERIAL PRIMARY KEY,
        date_depense TEXT NOT NULL,
        type_depense TEXT NOT NULL,
        description TEXT,
        montant_fcfa REAL NOT NULL,
        statut TEXT NOT NULL,
        id_demandeur INTEGER,
        id_validateur INTEGER,
        date_validation TEXT,
        piece_jointe_url TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS factures (
        id SERIAL PRIMARY KEY,
        fournisseur TEXT,
        numero_facture TEXT,
        date_emission TEXT,
        date_echeance TEXT,
        montant_fcfa REAL NOT NULL,
        statut TEXT NOT NULL,
        id_depense_liee INTEGER
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS validations (
        id SERIAL PRIMARY KEY,
        type_objet TEXT NOT NULL,
        id_objet INTEGER NOT NULL,
        id_demandeur INTEGER,
        id_validateur INTEGER,
        statut TEXT NOT NULL,
        date_demande TEXT,
        date_decision TEXT,
        commentaire TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS paie_mensuelle (
        id SERIAL PRIMARY KEY,
        mois TEXT NOT NULL,
        masse_salariale REAL NOT NULL
      )
    `);

    console.log('Tables Postgres prêtes');
  } catch (err) {
    console.error('Erreur initialisation Postgres :', err);
  }
}

initDb();

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