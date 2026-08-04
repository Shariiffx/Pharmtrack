const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const uri = process.env.MONGODB_URI || '';
const dbName = 'pharmacy_inventory';
let db;

async function connectDB() {
  try {
    const client = new MongoClient(uri, { maxPoolSize: 10 });
    await client.connect();
    db = client.db(dbName);
    console.log('MongoDB Atlas connected');
    return true;
  } catch (e) {
    console.error('DB connection failed:', e.message);
    return false;
  }
}

function buildIdFilter(id) {
  const { ObjectId } = require('mongodb');
  const filters = [{ id: id }, { ID: id }, { _id: id }];
  if (ObjectId.isValid(id) && (id.length === 24 || id.length === 12)) {
    filters.unshift({ _id: new ObjectId(id) });
  }
  return { $or: filters };
}

function normalizeDrug(drug) {
  const norm = { ...drug };
  if (norm.name !== undefined) norm.Name = norm.name;
  if (norm.Name !== undefined) norm.name = norm.Name;
  
  if (norm.generic_name !== undefined) norm.generic = norm.generic_name;
  if (norm.generic !== undefined) norm.generic_name = norm.generic;
  
  if (norm.hsn_code !== undefined) norm.hsn = norm.hsn_code;
  if (norm.hsn !== undefined) norm.hsn_code = norm.hsn;
  
  if (norm.schedule_type !== undefined) norm.schedule = norm.schedule_type;
  if (norm.schedule !== undefined) norm.schedule_type = norm.schedule;
  
  if (norm.dosage_form !== undefined) norm.form = norm.dosage_form;
  if (norm.form !== undefined) norm.dosage_form = norm.form;
  
  if (norm.batch_number !== undefined) norm.batch = norm.batch_number;
  if (norm.batch !== undefined) norm.batch_number = norm.batch;
  
  if (norm.expiry_date !== undefined) norm.expiry = norm.expiry_date;
  if (norm.expiry !== undefined) norm.expiry_date = norm.expiry;
  
  if (norm.current_stock !== undefined) norm.stock = parseInt(norm.current_stock) || 0;
  if (norm.stock !== undefined) norm.current_stock = parseInt(norm.stock) || 0;
  
  if (norm.reorder_level !== undefined) norm.reorder = parseInt(norm.reorder_level) || 0;
  if (norm.reorder !== undefined) norm.reorder_level = parseInt(norm.reorder) || 0;
  
  if (norm.purchase_price !== undefined) norm.purchasePrice = parseFloat(norm.purchase_price) || 0;
  if (norm.purchasePrice !== undefined) norm.purchase_price = parseFloat(norm.purchasePrice) || 0;
  
  if (norm.gst_rate !== undefined) norm.gst = parseFloat(norm.gst_rate) || 0;
  if (norm.gst !== undefined) norm.gst_rate = parseFloat(norm.gst) || 0;
  
  if (norm.supplier_name !== undefined) norm.supplier = norm.supplier_name;
  if (norm.supplier !== undefined) norm.supplier_name = norm.supplier;
  
  if (norm.category_name !== undefined) norm.category = norm.category_name;
  if (norm.category !== undefined) norm.category_name = norm.category;
  
  return norm;
}

function startServer() {
  app.get('/api/health', (req, res) => res.json({ status: db ? 'connected' : 'disconnected', db: !!db }));

  app.get('/api/drugs', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });

      const query = {};
      const { search, schedule, status } = req.query;

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { generic: { $regex: search, $options: 'i' } },
          { generic_name: { $regex: search, $options: 'i' } },
          { batch: { $regex: search, $options: 'i' } },
          { batch_number: { $regex: search, $options: 'i' } }
        ];
      }

      if (schedule && schedule !== 'all') {
        query.$and = query.$and || [];
        query.$and.push({ $or: [{ schedule_type: schedule }, { schedule: schedule }] });
      }

      if (status && status !== 'all') {
        const todayStr = new Date().toISOString().split('T')[0];
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        const thirtyDaysFromNowStr = thirtyDaysFromNow.toISOString().split('T')[0];

        if (status === 'expired') {
          query.$and = query.$and || [];
          query.$and.push({
            $or: [
              { expiry_date: { $lt: todayStr } },
              { expiry: { $lt: todayStr } }
            ]
          });
        } else if (status === 'out') {
          query.$and = query.$and || [];
          query.$and.push({
            $or: [
              { current_stock: 0 },
              { stock: 0 }
            ]
          });
        } else if (status === 'warn') {
          query.$and = query.$and || [];
          query.$and.push({
            $or: [
              {
                $or: [
                  { $expr: { $lte: ['$current_stock', '$reorder_level'] } },
                  { $expr: { $lte: ['$stock', '$reorder'] } }
                ]
              },
              { expiry_date: { $gte: todayStr, $lte: thirtyDaysFromNowStr } },
              { expiry: { $gte: todayStr, $lte: thirtyDaysFromNowStr } }
            ]
          });
        } else if (status === 'ok') {
          query.$and = query.$and || [];
          query.$and.push({
            $and: [
              {
                $or: [
                  { current_stock: { $gt: 0 } },
                  { stock: { $gt: 0 } }
                ]
              },
              {
                $or: [
                  { expiry_date: { $gt: thirtyDaysFromNowStr } },
                  { expiry: { $gt: thirtyDaysFromNowStr } }
                ]
              },
              {
                $or: [
                  { $expr: { $gt: ['$current_stock', '$reorder_level'] } },
                  { $expr: { $gt: ['$stock', '$reorder'] } }
                ]
              }
            ]
          });
        }
      }

      const limit = parseInt(req.query.limit) || 0;
      const skip = parseInt(req.query.skip) || 0;

      let cursor = db.collection('drugs').find(query);
      if (skip) cursor = cursor.skip(skip);
      if (limit) cursor = cursor.limit(limit);

      const drugs = await cursor.toArray();
      const total = await db.collection('drugs').countDocuments(query);

      res.json({ drugs, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/drugs', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const drug = normalizeDrug(req.body);
      drug.created_at = new Date();
      const result = await db.collection('drugs').insertOne(drug);
      res.json({ id: result.insertedId, message: 'Drug added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/drugs/:id', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const { id } = req.params;
      const updateData = normalizeDrug(req.body);
      delete updateData._id;
      await db.collection('drugs').updateOne(buildIdFilter(id), { $set: updateData });
      res.json({ message: 'Updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/drugs/:id', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const { id } = req.params;
      await db.collection('drugs').deleteOne(buildIdFilter(id));
      res.json({ message: 'Deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bills', async (req, res) => {
    try {
      if (db) {
        const bills = await db.collection('bills').find({}).sort({ created_at: -1 }).toArray();
        return res.json(bills);
      }
      res.status(503).json({ error: 'DB not connected' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bills', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const bill = { ...req.body };
      bill.created_at = new Date();
      const result = await db.collection('bills').insertOne(bill);
      res.json({ id: result.insertedId, message: 'Bill saved' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/bills/:id', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const { id } = req.params;
      await db.collection('bills').deleteOne(buildIdFilter(id));
      res.json({ message: 'Deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/parties', async (req, res) => {
    try {
      if (db) {
        const parties = await db.collection('parties').find({}).toArray();
        return res.json(parties);
      }
      res.status(503).json({ error: 'DB not connected' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/parties', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const party = { ...req.body };
      const result = await db.collection('parties').insertOne(party);
      res.json({ id: result.insertedId, message: 'Party added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/parties/:id', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const { id } = req.params;
      await db.collection('parties').deleteOne(buildIdFilter(id));
      res.json({ message: 'Deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/profile', async (req, res) => {
    try {
      if (db) {
        const profile = await db.collection('profile').findOne({});
        return profile ? res.json(profile) : res.json({});
      }
      res.status(503).json({ error: 'DB not connected' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/profile', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const profile = { ...req.body };
      delete profile._id;
      await db.collection('profile').updateOne({}, { $set: profile }, { upsert: true });
      res.json({ message: 'Profile saved' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/categories', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      let categories = await db.collection('categories').find({}).sort({ name: 1 }).toArray();
      if (categories.length === 0) {
        const fallbacks = [
          { name: 'Antibiotic', description: 'Bacterial infection treatment' },
          { name: 'Analgesic', description: 'Pain relief and anti-inflammatory' },
          { name: 'Antacid', description: 'Stomach acid reducer' },
          { name: 'Antidiabetic', description: 'Blood sugar control' },
          { name: 'Antihypertensive', description: 'Blood pressure control' },
          { name: 'Antihistamine', description: 'Allergy relief' },
          { name: 'Vitamin/Supplement', description: 'Nutritional supplements' },
          { name: 'Controlled', description: 'Restricted psychotropic substances' },
          { name: 'Other', description: 'Miscellaneous' }
        ];
        await db.collection('categories').insertMany(fallbacks);
        categories = await db.collection('categories').find({}).sort({ name: 1 }).toArray();
      }
      res.json(categories);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/categories', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const cat = { ...req.body };
      const result = await db.collection('categories').insertOne(cat);
      res.status(201).json({ id: result.insertedId, message: 'Category added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/suppliers', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      let suppliers = await db.collection('suppliers').find({}).sort({ name: 1 }).toArray();
      if (suppliers.length === 0) {
        const fallbacks = [
          { name: 'Sun Pharma', contact_person: 'Anil K.', phone: '9876543210', email: 'sales@sunpharma.com', address: 'Mumbai', is_active: 1 },
          { name: 'Cipla', contact_person: 'Rajesh P.', phone: '9876543211', email: 'sales@cipla.com', address: 'Mumbai', is_active: 1 },
          { name: 'Dr. Reddy\'s', contact_person: 'Amit S.', phone: '9876543212', email: 'sales@drreddys.com', address: 'Hyderabad', is_active: 1 },
          { name: 'Lupin', contact_person: 'Sanjay M.', phone: '9876543213', email: 'sales@lupin.com', address: 'Pune', is_active: 1 },
          { name: 'Abbott India', contact_person: 'Vikram G.', phone: '9876543214', email: 'sales@abbott.co.in', address: 'Mumbai', is_active: 1 },
          { name: 'Zydus', contact_person: 'Nitin D.', phone: '9876543215', email: 'sales@zyduscadila.com', address: 'Ahmedabad', is_active: 1 }
        ];
        await db.collection('suppliers').insertMany(fallbacks);
        suppliers = await db.collection('suppliers').find({}).sort({ name: 1 }).toArray();
      }
      res.json(suppliers);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/suppliers', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const supplier = { ...req.body, is_active: 1 };
      const result = await db.collection('suppliers').insertOne(supplier);
      res.status(201).json({ id: result.insertedId, message: 'Supplier added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/alerts', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const drugs = await db.collection('drugs').find({}).toArray();
      const today = new Date();
      const alerts = [];

      drugs.forEach(d => {
        const expiryDate = d.expiry_date || d.expiry;
        const currentStock = d.current_stock !== undefined ? parseInt(d.current_stock) : (d.stock !== undefined ? parseInt(d.stock) : 0);
        const reorderLevel = d.reorder_level !== undefined ? parseInt(d.reorder_level) : (d.reorder !== undefined ? parseInt(d.reorder) : 50);

        let daysLeft = null;
        if (expiryDate) {
          const exp = new Date(expiryDate);
          daysLeft = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
        }

        if (daysLeft !== null) {
          if (daysLeft <= 0) {
            alerts.push({ type: 'danger', msg: `<strong>${d.name || d.Name}</strong> has EXPIRED (${expiryDate})`, label: 'EXPIRED', drug: d });
          } else if (daysLeft <= 30) {
            alerts.push({ type: 'danger', msg: `<strong>${d.name || d.Name}</strong> expires in ${daysLeft} days`, label: `${daysLeft}d`, drug: d });
          } else if (daysLeft <= 90) {
            alerts.push({ type: 'warning', msg: `<strong>${d.name || d.Name}</strong> expires in ${daysLeft} days`, label: `${daysLeft}d`, drug: d });
          }
        }

        if (currentStock === 0) {
          alerts.push({ type: 'danger', msg: `<strong>${d.name || d.Name}</strong> is OUT OF STOCK`, label: 'OUT', drug: d });
        } else if (currentStock <= reorderLevel) {
          alerts.push({ type: 'warning', msg: `<strong>${d.name || d.Name}</strong> stock low: ${currentStock} (reorder: ${reorderLevel})`, label: 'LOW', drug: d });
        }
      });

      res.json({ alerts });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/reports', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const reportType = req.query.type || 'summary';
      const drugs = await db.collection('drugs').find({}).toArray();
      const today = new Date();

      if (reportType === 'summary') {
        let totalSKUs = drugs.length;
        let totalStock = 0;
        let totalValue = 0;
        let lowStock = 0;
        let outOfStock = 0;
        let expiredCount = 0;

        drugs.forEach(d => {
          const stock = d.current_stock !== undefined ? parseInt(d.current_stock) : (d.stock !== undefined ? parseInt(d.stock) : 0);
          const mrp = d.mrp !== undefined ? parseFloat(d.mrp) : 0;
          const reorder = d.reorder_level !== undefined ? parseInt(d.reorder_level) : (d.reorder !== undefined ? parseInt(d.reorder) : 50);
          const expiryDate = d.expiry_date || d.expiry;

          totalStock += stock;
          totalValue += stock * mrp;

          if (stock === 0) {
            outOfStock++;
          } else if (stock <= reorder) {
            lowStock++;
          }

          if (expiryDate) {
            const exp = new Date(expiryDate);
            if (exp < today) {
              expiredCount++;
            }
          }
        });

        return res.json({
          total_skus: totalSKUs,
          total_stock: totalStock,
          total_value: totalValue,
          low_stock: lowStock,
          out_of_stock: outOfStock,
          expired: expiredCount,
          alerts: lowStock + outOfStock + expiredCount
        });
      }

      if (reportType === 'by-schedule') {
        const counts = {};
        drugs.forEach(d => {
          const sch = d.schedule_type || d.schedule || 'OTC';
          counts[sch] = (counts[sch] || 0) + 1;
        });

        const total = drugs.length || 1;
        const result = Object.entries(counts).map(([schedule_type, count]) => ({
          schedule_type,
          count,
          percentage: parseFloat((count * 100 / total).toFixed(1))
        })).sort((a, b) => b.count - a.count);

        return res.json(result);
      }

      if (reportType === 'by-expiry') {
        const windows = {
          'Expired': 0,
          '< 30 days': 0,
          '30-90 days': 0,
          '> 90 days': 0
        };

        drugs.forEach(d => {
          const expiryDate = d.expiry_date || d.expiry;
          if (!expiryDate) {
            windows['> 90 days']++;
            return;
          }
          const exp = new Date(expiryDate);
          const daysLeft = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

          if (daysLeft < 0) {
            windows['Expired']++;
          } else if (daysLeft <= 30) {
            windows['< 30 days']++;
          } else if (daysLeft <= 90) {
            windows['30-90 days']++;
          } else {
            windows['> 90 days']++;
          }
        });

        const result = Object.entries(windows).map(([window, count]) => ({
          window,
          count
        })).sort((a, b) => b.count - a.count);

        return res.json(result);
      }

      if (reportType === 'by-category') {
        const categoriesData = {};
        drugs.forEach(d => {
          const cat = d.category_name || d.category || 'Other';
          const stock = d.current_stock !== undefined ? parseInt(d.current_stock) : (d.stock !== undefined ? parseInt(d.stock) : 0);
          const mrp = d.mrp !== undefined ? parseFloat(d.mrp) : 0;

          if (!categoriesData[cat]) {
            categoriesData[cat] = { category: cat, items: 0, units: 0, value: 0 };
          }
          categoriesData[cat].items++;
          categoriesData[cat].units += stock;
          categoriesData[cat].value += stock * mrp;
        });

        const result = Object.values(categoriesData).sort((a, b) => b.items - a.items);
        return res.json(result);
      }

      if (reportType === 'valuation') {
        const result = drugs.map(d => {
          const stock = d.current_stock !== undefined ? parseInt(d.current_stock) : (d.stock !== undefined ? parseInt(d.stock) : 0);
          const mrp = d.mrp !== undefined ? parseFloat(d.mrp) : 0;
          const purchasePrice = d.purchase_price !== undefined ? parseFloat(d.purchase_price) : (d.purchasePrice !== undefined ? parseFloat(d.purchasePrice) : 0);

          return {
            name: d.name || d.Name,
            current_stock: stock,
            mrp,
            purchase_price: purchasePrice,
            margin: mrp - purchasePrice,
            stock_value: stock * mrp
          };
        }).sort((a, b) => b.stock_value - a.stock_value);

        return res.json(result);
      }

      res.status(400).json({ error: 'Invalid report type' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/purchase-orders', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const pos = await db.collection('purchase_orders').find({}).sort({ created_at: -1 }).toArray();
      res.json(pos);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/purchase-orders', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const po = { ...req.body, created_at: new Date() };
      const result = await db.collection('purchase_orders').insertOne(po);
      res.status(201).json({ id: result.insertedId, message: 'Purchase Order saved' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/purchase-orders/:id', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'DB not connected' });
      const { id } = req.params;
      await db.collection('purchase_orders').deleteOne(buildIdFilter(id));
      res.json({ message: 'Purchase Order deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.use(express.static('public'));
  app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  const port = process.env.PORT || (process.versions.electron ? 0 : 3001);
  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`Server running on http://localhost:${actualPort}`);
    if (process.versions.electron) {
      global.expressPort = actualPort;
    }
  });
}

connectDB().then(connected => {
  if (!connected) console.log('Running without DB — API endpoints will return 503 until DB connects');
  startServer();
});
