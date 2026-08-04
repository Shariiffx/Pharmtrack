const fs = require('fs');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const dbName = 'pharmacy_inventory';

const path = require('path');

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.length < headers.length) continue;
    const record = {};
    headers.forEach((h, idx) => { record[h] = values[idx] || ''; });
    record.name = record.Name || '';
    record.generic = record.Generic || '';
    record.schedule = record.Schedule || 'OTC';
    record.batch = record.Batch || '';
    const expiryRaw = record.Expiry || '';
    if (expiryRaw && expiryRaw.includes('/')) {
      const [mm, yyyy] = expiryRaw.split('/');
      record.expiry = `${yyyy}-${(mm || '01').padStart(2, '0')}-01`;
    } else {
      record.expiry = expiryRaw;
    }
    record.stock = parseInt(record.Stock) || 0;
    record.reorder = parseInt(record.Reorder) || 10;
    record.mrp = parseFloat(record.MRP) || 0;
    record.supplier = record.Supplier || '';
    record.category = 'Imported';
    record.form = 'Tablet';
    record.gst = 5;
    record.purchasePrice = record.mrp * 0.7;
    records.push(record);
  }
  return records;
}

async function main() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('drugs');

    const findCSV = (filename) => {
      const localPath = path.join(__dirname, filename);
      if (fs.existsSync(localPath)) return localPath;
      const downloadsPath = path.join(process.env.HOME || '/Users/sharifmolla', 'Downloads', filename);
      if (fs.existsSync(downloadsPath)) return downloadsPath;
      return null;
    };

    const file2 = findCSV('Indian_Pharmacy_Inventory_Zero_Stock.csv');
    if (!file2) {
      console.error('File Indian_Pharmacy_Inventory_Zero_Stock.csv not found.');
      await client.close();
      return;
    }

    const records = parseCSV(file2);
    console.log(`Zero-stock file: ${records.length} records`);

    if (records.length === 0) {
      console.log('No records to upsert.');
      await client.close();
      return;
    }

    const bulkOps = records.map(r => ({
      updateOne: {
        filter: { ID: r.ID },
        update: {
          $set: {
            ...r,
            stock: r.stock,
            updated_at: new Date()
          }
        },
        upsert: true
      }
    }));

    console.log('Running bulk write upsert...');
    const result = await collection.bulkWrite(bulkOps, { ordered: false });
    console.log(`✓ Upsert completed`);
    console.log(`✓ Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}, Upserted: ${result.upsertedCount}`);
    console.log(`✓ Total records in DB: ${await collection.countDocuments()}`);

    await client.close();
  } catch (error) {
    console.error('Import failed:', error.message);
    process.exit(1);
  }
}

main();
