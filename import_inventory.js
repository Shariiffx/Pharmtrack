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
    headers.forEach((h, idx) => {
      record[h] = values[idx] || '';
    });
    
    // Transform data
    record.name = record.Name || '';
    record.generic = record.Generic || '';
    record.schedule = record.Schedule || 'OTC';
    record.batch = record.Batch || '';
    
    // Convert expiry from MM/YYYY to YYYY-MM-DD
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

    const file1 = findCSV('Indian_Pharmacy_Inventory.csv');
    const file2 = findCSV('Indian_Pharmacy_Inventory_Zero_Stock.csv');
    
    console.log('Reading CSV files...');
    const records1 = file1 ? parseCSV(file1) : [];
    console.log(`File 1 (${file1 || 'Not found'}): ${records1.length} records`);
    
    const records2 = file2 ? parseCSV(file2) : [];
    console.log(`File 2 (${file2 || 'Not found'}): ${records2.length} records`);
    
    // Merge unique records by ID
    const allRecords = [...records1];
    if (records2.length) {
      const ids1 = new Set(records1.map(r => r.ID));
      records2.forEach(r => {
        if (!ids1.has(r.ID)) {
          allRecords.push(r);
        }
      });
    }
    
    console.log(`Total unique records: ${allRecords.length}`);
    
    console.log('Clearing collection...');
    await collection.deleteMany({});
    
    console.log('Inserting records...');
    const batchSize = 500;
    for (let i = 0; i < allRecords.length; i += batchSize) {
      const batch = allRecords.slice(i, i + batchSize);
      await collection.insertMany(batch);
      process.stdout.write(`\rProgress: ${Math.min(i + batchSize, allRecords.length)}/${allRecords.length}`);
    }
    
    const count = await collection.countDocuments();
    console.log(`\n✓ Import completed!`);
    console.log(`✓ Total records in DB: ${count}`);
    console.log(`✓ Total value at MRP: ₹${(await collection.aggregate([{$group: {_id: null, total: {$sum: {$multiply: ['$stock', '$mrp']}}}}]).toArray())[0]?.total?.toFixed(2) || 0}`);
    
    await client.close();
    
  } catch (error) {
    console.error('Import failed:', error.message);
    process.exit(1);
  }
}

main();
