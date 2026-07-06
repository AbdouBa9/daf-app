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

        await pool.query(`
      ALTER TABLE paie_mensuelle
      ADD CONSTRAINT paie_mensuelle_mois_unique UNIQUE (mois)
    `).catch(() => {});

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
app.get('/api/depenses', async (req, res) => {
  try {
    const { statut, type_depense } = req.query;
    let sql = 'SELECT * FROM depenses WHERE 1=1';
    const values = [];

    if (statut) {
      values.push(statut);
      sql += ` AND statut = $${values.length}`;
    }

    if (type_depense) {
      values.push(type_depense);
      sql += ` AND type_depense = $${values.length}`;
    }

    sql += ' ORDER BY date_depense DESC';

    const result = await pool.query(sql, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/depenses/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM depenses WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dépense non trouvée' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/depenses', async (req, res) => {
  try {
    const { date_depense, type_depense, description, montant_fcfa, action } = req.body;

    if (!date_depense || !type_depense || !montant_fcfa) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    const statut = action === 'validation' ? 'en_validation' : 'brouillon';

    const insertDepense = await pool.query(
      `INSERT INTO depenses
       (date_depense, type_depense, description, montant_fcfa, statut)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [date_depense, type_depense, description || '', montant_fcfa, statut]
    );

    const newId = insertDepense.rows[0].id;

    if (statut === 'en_validation') {
      await pool.query(
        `INSERT INTO validations (type_objet, id_objet, statut, date_demande)
         VALUES ($1, $2, $3, NOW()::text)`,
        ['depense', newId, 'en_attente']
      );
    }

    res.status(201).json({ id: newId, statut });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/factures', async (req, res) => {
  try {
    const { statut } = req.query;
    let sql = 'SELECT * FROM factures WHERE 1=1';
    const values = [];

    if (statut) {
      values.push(statut);
      sql += ` AND statut = $${values.length}`;
    }

    sql += ' ORDER BY date_echeance ASC';

    const result = await pool.query(sql, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/factures/:id', (req, res) => {
  res.status(501).json({ error: 'Route pas encore migrée vers Postgres' });
});

app.post('/api/factures', async (req, res) => {
  try {
    const {
      fournisseur,
      numero_facture,
      date_emission,
      date_echeance,
      montant_fcfa,
      statut,
      id_depense_liee
    } = req.body;

    if (!fournisseur || !date_echeance || !montant_fcfa) {
      return res.status(400).json({ error: 'Fournisseur, date échéance et montant sont obligatoires' });
    }

    const statutFinal = statut || 'reçue';

    const result = await pool.query(
      `INSERT INTO factures
       (fournisseur, numero_facture, date_emission, date_echeance, montant_fcfa, statut, id_depense_liee)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        fournisseur,
        numero_facture || '',
        date_emission || '',
        date_echeance,
        montant_fcfa,
        statutFinal,
        id_depense_liee || null
      ]
    );

    res.status(201).json({ id: result.rows[0].id, statut: statutFinal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

app.get('/api/dashboard/daf', async (req, res) => {
  try {
    const { mois } = req.query;
    const moisPrefix = (mois || '').slice(0, 7);

    const result = {};
    result.tresorerie = 12400000;

    const depensesResult = await pool.query(
      `SELECT COALESCE(SUM(montant_fcfa), 0) AS total
       FROM depenses
       WHERE statut IN ('validée', 'payée')
       AND SUBSTRING(date_depense, 1, 7) = $1`,
      [moisPrefix]
    );
    result.depenses_mois = Number(depensesResult.rows[0].total || 0);

    const facturesResult = await pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(montant_fcfa), 0) AS total
       FROM factures
       WHERE statut IN ('reçue', 'en_validation')`
    );
    result.factures_en_attente_nombre = Number(facturesResult.rows[0].n || 0);
    result.factures_en_attente_montant = Number(facturesResult.rows[0].total || 0);

    const paieResult = await pool.query(
      `SELECT masse_salariale
       FROM paie_mensuelle
       WHERE mois = $1`,
      [moisPrefix]
    );
    result.masse_salariale = paieResult.rows[0]
      ? Number(paieResult.rows[0].masse_salariale || 0)
      : 0;

    const validationsResult = await pool.query(
      `SELECT COUNT(*) AS n
       FROM validations
       WHERE statut = 'en_attente'`
    );
    result.validations_en_attente = Number(validationsResult.rows[0].n || 0);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/paie', async (req, res) => {
  try {
    const { mois } = req.query;

    if (!mois) {
      return res.status(400).json({ error: 'Paramètre mois manquant (AAAA-MM)' });
    }

    const result = await pool.query(
      `SELECT masse_salariale FROM paie_mensuelle WHERE mois = $1`,
      [mois]
    );

    res.json({
      mois,
      masse_salariale: result.rows[0]
        ? Number(result.rows[0].masse_salariale || 0)
        : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paie', async (req, res) => {
  try {
    const { mois, masse_salariale } = req.body;

    if (!mois || typeof masse_salariale !== 'number') {
      return res.status(400).json({ error: 'mois (AAAA-MM) et masse_salariale (nombre) requis' });
    }

    await pool.query(
      `INSERT INTO paie_mensuelle (mois, masse_salariale)
       VALUES ($1, $2)
       ON CONFLICT (mois)
       DO UPDATE SET masse_salariale = EXCLUDED.masse_salariale`,
      [mois, masse_salariale]
    );

    res.json({ message: 'Masse salariale enregistrée', mois, masse_salariale });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur DAF en écoute sur port ${PORT}`);
});