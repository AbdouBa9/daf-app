// server.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
//const sqlite3 = require('sqlite3').verbose();
//const path = require('path');

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

// DB SQLite
//const dbFile = path.join(__dirname, 'daf.db');
//const db = new sqlite3.Database(dbFile);


// Création des tables au démarrage
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT,
    mot_de_passe_hash TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS depenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_depense TEXT NOT NULL,
    type_depense TEXT NOT NULL,
    description TEXT,
    montant_fcfa REAL NOT NULL,
    statut TEXT NOT NULL,
    id_demandeur INTEGER,
    id_validateur INTEGER,
    date_validation TEXT,
    piece_jointe_url TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS factures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fournisseur TEXT,
    numero_facture TEXT,
    date_emission TEXT,
    date_echeance TEXT,
    montant_fcfa REAL NOT NULL,
    statut TEXT NOT NULL,
    id_depense_liee INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_objet TEXT NOT NULL,
    id_objet INTEGER NOT NULL,
    id_demandeur INTEGER,
    id_validateur INTEGER,
    statut TEXT NOT NULL,
    date_demande TEXT,
    date_decision TEXT,
    commentaire TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS paie_mensuelle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mois TEXT NOT NULL,
    masse_salariale REAL NOT NULL
  )`);
});

// Route test
app.get('/', (req, res) => {
  res.json({ message: 'API DAF opérationnelle' });
});

// Liste des dépenses avec filtres
app.get('/api/depenses', (req, res) => {
  const { statut, type_depense } = req.query;
  let sql = 'SELECT * FROM depenses WHERE 1=1';
  const params = [];

  if (statut) {
    sql += ' AND statut = ?';
    params.push(statut);
  }
  if (type_depense) {
    sql += ' AND type_depense = ?';
    params.push(type_depense);
  }

  sql += ' ORDER BY date_depense DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/depenses/:id', (req, res) => {
  db.get('SELECT * FROM depenses WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Dépense non trouvée' });
    res.json(row);
  });
});

// Création d’une dépense
app.post('/api/depenses', (req, res) => {
  const { date_depense, type_depense, description, montant_fcfa, action } = req.body;

  if (!date_depense || !type_depense || !montant_fcfa) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  const statut = action === 'validation' ? 'en_validation' : 'brouillon';

  const sql = `INSERT INTO depenses
    (date_depense, type_depense, description, montant_fcfa, statut)
    VALUES (?, ?, ?, ?, ?)`;
  const params = [date_depense, type_depense, description || '', montant_fcfa, statut];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });

    // Si en validation, créer une validation liée
    if (statut === 'en_validation') {
      db.run(
        `INSERT INTO validations (type_objet, id_objet, statut, date_demande)
         VALUES (?, ?, ?, datetime('now'))`,
        ['depense', this.lastID, 'en_attente']
      );
    }

    res.status(201).json({ id: this.lastID, statut });
  });
});

// Liste des factures avec filtres simples
app.get('/api/factures', (req, res) => {
  const { statut } = req.query;
  let sql = 'SELECT * FROM factures WHERE 1=1';
  const params = [];

  if (statut) {
    sql += ' AND statut = ?';
    params.push(statut);
  }

  sql += ' ORDER BY date_echeance ASC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Détail d'une facture
app.get('/api/factures/:id', (req, res) => {
  db.get('SELECT * FROM factures WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Facture non trouvée' });
    res.json(row);
  });
});

// Création d'une facture
app.post('/api/factures', (req, res) => {
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

  const sql = `INSERT INTO factures
    (fournisseur, numero_facture, date_emission, date_echeance, montant_fcfa, statut, id_depense_liee)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    fournisseur,
    numero_facture || '',
    date_emission || '',
    date_echeance,
    montant_fcfa,
    statutFinal,
    id_depense_liee || null
  ];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, statut: statutFinal });
  });
});

// Liste des validations
app.get('/api/validations', (req, res) => {
  const { statut } = req.query; // ex: ?statut=en_attente
  let sql = 'SELECT * FROM validations WHERE 1=1';
  const params = [];

  if (statut) {
    sql += ' AND statut = ?';
    params.push(statut);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Décision de validation (valider / rejeter)
app.put('/api/validations/:id', (req, res) => {
  const { statut, commentaire, id_validateur } = req.body;
  if (!statut) return res.status(400).json({ error: 'Statut manquant' });

  const sqlVal = `UPDATE validations
    SET statut = ?, commentaire = ?, id_validateur = ?, date_decision = datetime('now')
    WHERE id = ?`;

  db.run(sqlVal, [statut, commentaire || '', id_validateur || null, req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Validation non trouvée' });

    // Récupérer l’objet lié (dépense ou facture)
    db.get('SELECT type_objet, id_objet FROM validations WHERE id = ?', [req.params.id], (err2, row) => {
      if (err2 || !row) return res.json({ message: 'Validation mise à jour, mais objet non trouvé' });

      let table = null;
      if (row.type_objet === 'depense') table = 'depenses';
      if (row.type_objet === 'facture') table = 'factures';

      if (!table) return res.json({ message: 'Validation mise à jour, type objet inconnu' });

      const nouveauStatut = statut === 'validée' ? 'validée' : 'rejetée';
      const sqlObj = `UPDATE ${table} SET statut = ? WHERE id = ?`;
      db.run(sqlObj, [nouveauStatut, row.id_objet]);

      res.json({ message: 'Validation et objet mis à jour', statut: nouveauStatut });
    });
  });
});

// Utilisateur courant (V1 : sélection par paramètre ?id=)
app.get('/api/user/current', (req, res) => {
  // Si on passe ?id=2, on prend cet id, sinon on reste sur 1 (Souadou)
  const idParam = req.query.id;
  const currentUserId = idParam ? Number(idParam) : 1;

  db.get(
    'SELECT id, nom, role, email FROM users WHERE id = ?',
    [currentUserId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Utilisateur courant non trouvé' });
      res.json(row);
    }
  );
});

// Dashboard DAF
app.get('/api/dashboard/daf', (req, res) => {
  const { mois } = req.query; // format "2026-06"
  const moisPrefix = (mois || '').slice(0, 7); // on garde AAAA-MM

  const result = {};

  // 1) Trésorerie (pour l'instant, valeur fixe, on l'ajustera plus tard)
  result.tresorerie = 12400000; // ex : 12,4 M FCFA

  // 2) Dépenses du mois
  const sqlDep = `SELECT SUM(montant_fcfa) AS total
                  FROM depenses
                  WHERE statut IN ('validée','payée')
                  AND substr(date_depense,1,7) = ?`;
  db.get(sqlDep, [moisPrefix], (err, rowDep) => {
    if (err) return res.status(500).json({ error: err.message });
    result.depenses_mois = rowDep && rowDep.total ? rowDep.total : 0;

    // 3) Factures en attente
    const sqlFact = `SELECT COUNT(*) AS n, SUM(montant_fcfa) AS total
                     FROM factures
                     WHERE statut IN ('reçue','en_validation')`;
    db.get(sqlFact, [], (err2, rowFact) => {
      if (err2) return res.status(500).json({ error: err2.message });
      result.factures_en_attente_nombre = rowFact && rowFact.n ? rowFact.n : 0;
      result.factures_en_attente_montant = rowFact && rowFact.total ? rowFact.total : 0;

      // 4) Masse salariale du mois
      const sqlPaie = `SELECT masse_salariale FROM paie_mensuelle WHERE mois = ?`;
      db.get(sqlPaie, [moisPrefix], (err3, rowPaie) => {
        if (err3) return res.status(500).json({ error: err3.message });
        result.masse_salariale = rowPaie && rowPaie.masse_salariale ? rowPaie.masse_salariale : 0;

        // 5) Validations en attente
        const sqlVal = `SELECT COUNT(*) AS n FROM validations WHERE statut = 'en_attente'`;
        db.get(sqlVal, [], (err4, rowVal) => {
          if (err4) return res.status(500).json({ error: err4.message });
          result.validations_en_attente = rowVal && rowVal.n ? rowVal.n : 0;

          res.json(result);
        });
      });
    });
  });
});

// Obtenir la masse salariale d'un mois
app.get('/api/paie', (req, res) => {
  const { mois } = req.query; // format "2026-06"
  if (!mois) {
    return res.status(400).json({ error: 'Paramètre mois manquant (AAAA-MM)' });
  }

  const sql = `SELECT masse_salariale FROM paie_mensuelle WHERE mois = ?`;
  db.get(sql, [mois], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      mois,
      masse_salariale: row && row.masse_salariale ? row.masse_salariale : 0
    });
  });
});

// Créer / mettre à jour la masse salariale d'un mois
app.post('/api/paie', (req, res) => {
  const { mois, masse_salariale } = req.body;

  if (!mois || typeof masse_salariale !== 'number') {
    return res.status(400).json({ error: 'mois (AAAA-MM) et masse_salariale (nombre) requis' });
  }

  const sqlSelect = `SELECT id FROM paie_mensuelle WHERE mois = ?`;
  db.get(sqlSelect, [mois], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (row) {
      // mise à jour
      const sqlUpdate = `UPDATE paie_mensuelle SET masse_salariale = ? WHERE id = ?`;
      db.run(sqlUpdate, [masse_salariale, row.id], function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ message: 'Masse salariale mise à jour', mois, masse_salariale });
      });
    } else {
      // insertion
      const sqlInsert = `INSERT INTO paie_mensuelle (mois, masse_salariale) VALUES (?, ?)`;
      db.run(sqlInsert, [mois, masse_salariale], function (err3) {
        if (err3) return res.status(500).json({ error: err3.message });
        res.status(201).json({ message: 'Masse salariale créée', mois, masse_salariale });
      });
    }
  });
});

// Serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur DAF en écoute sur port ${PORT}`);
});