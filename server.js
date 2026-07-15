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

    // Contrainte d’unicité sur le mois (ignore si déjà créée)
    await pool.query(`
      ALTER TABLE paie_mensuelle
      ADD CONSTRAINT paie_mensuelle_mois_unique UNIQUE (mois)
    `).catch(() => {});

    // Index utiles pour les filtres fréquents
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_depenses_statut ON depenses(statut)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date_depense)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_factures_statut ON factures(statut)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_factures_date_echeance ON factures(date_echeance)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_validations_statut ON validations(statut)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_paie_mois ON paie_mensuelle(mois)`);

    console.log('Tables Postgres prêtes');
  } catch (err) {
    console.error('Erreur initialisation Postgres :', err);
  }
}

initDb();

// ------------------------ MIDDLEWARES AUTH / ROLES ------------------------

// ------------------------ MIDDLEWARES AUTH / ROLES ------------------------


async function authCompat(req, res, next) {
  try {
    let userIdValue = req.header('x-user-id');

    if (!userIdValue) {
      userIdValue = req.query.userId;
    }

    if (!userIdValue) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    const userId = parseInt(userIdValue, 10);

    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Identifiant utilisateur invalide' });
    }

    const result = await pool.query(
      `SELECT id, nom, role, email
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur introuvable' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error('authCompat', err);
    res.status(500).json({ error: err.message });
  }
}

function autoriserRoles(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    if (!rolesAutorises.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Accès interdit',
        role_actuel: req.user.role,
        roles_autorises: rolesAutorises
      });
    }

    next();
  };
}

// Route test
app.get('/', (req, res) => {
  res.json({ message: 'API DAF opérationnelle' });
});

// ------------------------ DÉPENSES ------------------------

app.get(
  '/api/depenses',
  authCompat,
  autoriserRoles('admin', 'requester', 'validator'),
  async (req, res) => {
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

      sql += ' ORDER BY date_depense DESC, id DESC';

      const result = await pool.query(sql, values);
      res.json(result.rows);
    } catch (err) {
      console.error('GET /api/depenses', err);
      res.status(500).json({ error: err.message });
    }
  }
);

app.get(
  '/api/depenses/:id',
  authCompat,
  autoriserRoles('admin', 'requester', 'validator'),
  async (req, res) => {
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
      console.error('GET /api/depenses/:id', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Création de dépense + éventuelle demande de validation en transaction
app.post(
  '/api/depenses',
  authCompat,
  autoriserRoles('admin', 'requester'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { date_depense, type_depense, description, montant_fcfa, action } = req.body;

      if (!date_depense || !type_depense || typeof montant_fcfa !== 'number') {
        return res.status(400).json({ error: 'date_depense, type_depense et montant_fcfa sont obligatoires' });
      }

      const statut = action === 'validation' ? 'en_validation' : 'brouillon';

      await client.query('BEGIN');

      const insertDepense = await client.query(
        `INSERT INTO depenses
         (date_depense, type_depense, description, montant_fcfa, statut)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [date_depense, type_depense, description || '', montant_fcfa, statut]
      );

      const newId = insertDepense.rows[0].id;

      if (statut === 'en_validation') {
        await client.query(
          `INSERT INTO validations (type_objet, id_objet, statut, date_demande)
           VALUES ($1, $2, $3, NOW()::text)`,
          ['depense', newId, 'en_attente']
        );
      }

      await client.query('COMMIT');

      res.status(201).json({ id: newId, statut });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/depenses', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

// ------------------------ FACTURES ------------------------

app.get(
  '/api/factures',
  authCompat,
  autoriserRoles('admin', 'payer', 'validator'),
  async (req, res) => {
    try {
      const { statut } = req.query;
      let sql = 'SELECT * FROM factures WHERE 1=1';
      const values = [];

      if (statut) {
        values.push(statut);
        sql += ` AND statut = $${values.length}`;
      }

      sql += ' ORDER BY date_echeance ASC, id ASC';

      const result = await pool.query(sql, values);
      res.json(result.rows);
    } catch (err) {
      console.error('GET /api/factures', err);
      res.status(500).json({ error: err.message });
    }
  }
);

app.get(
  '/api/factures/:id',
  authCompat,
  autoriserRoles('admin', 'payer', 'validator'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        'SELECT * FROM factures WHERE id = $1',
        [id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Facture introuvable' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('GET /api/factures/:id', err);
      res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  '/api/factures',
  authCompat,
  autoriserRoles('admin', 'payer'),
  async (req, res) => {
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

      if (!fournisseur || !date_echeance || typeof montant_fcfa !== 'number') {
        return res.status(400).json({ error: 'Fournisseur, date échéance et montant (nombre) sont obligatoires' });
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
      console.error('POST /api/factures', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ------------------------ VALIDATIONS ------------------------

app.get(
  '/api/validations',
  authCompat,
  autoriserRoles('admin', 'validator'),
  async (req, res) => {
    try {
      const { statut } = req.query;
      let sql = 'SELECT * FROM validations WHERE 1=1';
      const values = [];

      if (statut) {
        values.push(statut);
        sql += ` AND statut = $${values.length}`;
      }

      sql += ' ORDER BY date_demande DESC, id DESC';

      const result = await pool.query(sql, values);
      res.json(result.rows);
    } catch (err) {
      console.error('GET /api/validations', err);
      res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  '/api/validations',
  authCompat,
  autoriserRoles('admin', 'validator'),
  async (req, res) => {
    try {
      const {
        type_objet,
        id_objet,
        id_demandeur,
        id_validateur,
        statut,
        commentaire,
        date_demande
      } = req.body;

      if (!type_objet || !id_objet) {
        return res.status(400).json({
          error: 'type_objet et id_objet sont obligatoires'
        });
      }

      const statutFinal = statut || 'en_attente';
      const dateDemandeFinale = date_demande || new Date().toISOString().slice(0, 10);

      const result = await pool.query(
        `INSERT INTO validations
         (type_objet, id_objet, id_demandeur, id_validateur, statut, date_demande, commentaire)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, statut`,
        [
          type_objet,
          id_objet,
          id_demandeur || null,
          id_validateur || null,
          statutFinal,
          dateDemandeFinale,
          commentaire || ''
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('POST /api/validations', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Mise à jour validation + statut de dépense liée en transaction
app.put(
  '/api/validations/:id',
  authCompat,
  autoriserRoles('admin', 'validator'),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { id } = req.params;
      const { statut, id_validateur, date_decision, commentaire } = req.body;

      if (!statut) {
        return res.status(400).json({ error: 'Le statut est obligatoire' });
      }

      await client.query('BEGIN');

      const valResult = await client.query(
        `SELECT type_objet, id_objet
         FROM validations
         WHERE id = $1`,
        [id]
      );

      if (valResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Validation introuvable' });
      }

      const validation = valResult.rows[0];

      const validateurFinal = id_validateur || req.user.id;
      const dateDecisionFinale = date_decision || new Date().toISOString().slice(0, 10);

      const updateVal = await client.query(
        `UPDATE validations
         SET statut = $1,
             id_validateur = $2,
             date_decision = $3,
             commentaire = $4
         WHERE id = $5
         RETURNING id, statut, id_validateur, date_decision, commentaire`,
        [
          statut,
          validateurFinal,
          dateDecisionFinale,
          commentaire || '',
          id
        ]
      );

      if (validation.type_objet === 'depense') {
        let nouveauStatutDepense;

        if (statut === 'validée') {
          nouveauStatutDepense = 'validée';
        } else if (statut === 'rejetée') {
          nouveauStatutDepense = 'rejetée';
        } else if (statut === 'en_attente') {
          nouveauStatutDepense = 'en_validation';
        }

        if (nouveauStatutDepense) {
          await client.query(
            `UPDATE depenses
             SET statut = $1,
                 id_validateur = $2,
                 date_validation = $3
             WHERE id = $4`,
            [
              nouveauStatutDepense,
              validateurFinal,
              dateDecisionFinale,
              validation.id_objet
            ]
          );
        }
      }

      await client.query('COMMIT');

      res.json({
        ...updateVal.rows[0],
        utilisateur: req.user.nom,
        role: req.user.role
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PUT /api/validations/:id', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

    // Si validation porte sur une dépense, on synchronise le statut de la dépense
   

// ------------------------ UTILISATEUR COURANT ------------------------

app.get('/api/user/current', authCompat, async (req, res) => {
  try {
    res.json(req.user);
  } catch (err) {
    console.error('GET /api/user/current', err);
    res.status(500).json({ error: err.message });
  }
});``


// ------------------------ DASHBOARD ------------------------

app.get(
  '/api/dashboard/daf',
  authCompat,
  autoriserRoles('admin'),
  async (req, res) => {
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
      console.error('GET /api/dashboard/daf', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ------------------------ PAIE ------------------------

app.get(
  '/api/paie',
  authCompat,
  autoriserRoles('admin', 'payer'),
  async (req, res) => {
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
      console.error('GET /api/paie', err);
      res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  '/api/paie',
  authCompat,
  autoriserRoles('admin', 'payer'),
  async (req, res) => {
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

      res.json({
        message: 'Masse salariale enregistrée',
        mois,
        masse_salariale,
        utilisateur: req.user.nom,
        role: req.user.role
      });
    } catch (err) {
      console.error('POST /api/paie', err);
      res.status(500).json({ error: err.message });
    }
  }
);

app.get(
  '/api/debug/users',
  authCompat,
  autoriserRoles('admin'),
  async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, nom, role, email FROM users ORDER BY id ASC'
      );
      res.json(result.rows);
    } catch (err) {
      console.error('GET /api/debug/users', err);
      res.status(500).json({ error: err.message });
    }
  }
);



// ------------------------ HEALTH ------------------------

app.get('/api/health', authCompat, (req, res) => {
  res.json({
    status: 'ok',
    user: req.user
  });
});

// ------------------------ SERVEUR ------------------------

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Serveur DAF en écoute sur port ${PORT}`);
});

// Arrêt propre
process.on('SIGTERM', async () => {
  console.log('SIGTERM reçu, arrêt du serveur...');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT reçu, arrêt du serveur...');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});