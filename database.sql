-- Pharmacy Inventory Management System - MySQL Schema
-- Database: pharmacy_inventory
-- Run this script to create the database and tables

CREATE DATABASE IF NOT EXISTS pharmacy_inventory
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pharmacy_inventory;

-- Drug categories
CREATE TABLE categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Suppliers
CREATE TABLE suppliers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(150),
  address TEXT,
  gstin VARCHAR(20),
  license_number VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Drug master table
CREATE TABLE drugs (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  generic_name VARCHAR(200),
  hsn_code VARCHAR(20),
  schedule_type ENUM('OTC','Schedule H','Schedule H1','Schedule X') DEFAULT 'OTC',
  category_id INT UNSIGNED,
  dosage_form ENUM('Tablet','Capsule','Syrup','Injection','Cream/Ointment','Drops','Inhaler','Other') DEFAULT 'Tablet',
  batch_number VARCHAR(50) NOT NULL,
  expiry_date DATE NOT NULL,
  current_stock INT UNSIGNED DEFAULT 0,
  reorder_level INT UNSIGNED DEFAULT 50,
  unit_of_measure VARCHAR(20) DEFAULT 'units',
  purchase_price DECIMAL(10,2) DEFAULT 0,
  mrp DECIMAL(10,2) DEFAULT 0,
  gst_rate DECIMAL(5,2) DEFAULT 5,
  supplier_id INT UNSIGNED,
  storage_conditions TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_expiry (expiry_date),
  INDEX idx_stock (current_stock),
  INDEX idx_category (category_id),
  INDEX idx_supplier (supplier_id),
  INDEX idx_schedule (schedule_type),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Purchase orders
CREATE TABLE purchase_orders (
  id VARCHAR(20) PRIMARY KEY,
  supplier_id INT UNSIGNED,
  order_date DATE NOT NULL,
  expected_delivery DATE,
  total_amount DECIMAL(12,2) DEFAULT 0,
  status ENUM('Draft','Pending','Ordered','Received','Cancelled') DEFAULT 'Draft',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Purchase order line items
CREATE TABLE purchase_order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id VARCHAR(20) NOT NULL,
  drug_id VARCHAR(20) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  gst_rate DECIMAL(5,2) DEFAULT 5,
  total_amount DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (drug_id) REFERENCES drugs(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Dispensing / sales log
CREATE TABLE dispensing_log (
  id VARCHAR(20) PRIMARY KEY,
  drug_id VARCHAR(20) NOT NULL,
  patient_id VARCHAR(50),
  prescription_number VARCHAR(50),
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  gst_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  staff_id VARCHAR(20),
  staff_name VARCHAR(100),
  dispensing_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (drug_id) REFERENCES drugs(id) ON DELETE RESTRICT,
  INDEX idx_dispensing_date (dispensing_date)
) ENGINE=InnoDB;

-- Audit log for changes
CREATE TABLE audit_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  record_id VARCHAR(50) NOT NULL,
  action ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  old_values JSON,
  new_values JSON,
  user_id VARCHAR(50),
  user_name VARCHAR(100),
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_table_record (table_name, record_id)
) ENGINE=InnoDB;

-- Users table for authentication
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('Admin','Pharmacist','Staff','Viewer') DEFAULT 'Staff',
  email VARCHAR(150),
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Insert default admin user (password: admin123 - must be changed after first login)
-- Password hash for "admin123" using bcrypt
INSERT INTO users (username, password_hash, full_name, role, email)
VALUES ('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System Administrator', 'Admin', 'admin@pharmtrack.com');

-- Insert default categories
INSERT INTO categories (name, description) VALUES
('Antibiotic', 'Antimicrobial medications'),
('Analgesic', 'Pain relief medications'),
('Antacid', 'Gastrointestinal medications'),
('Antidiabetic', 'Diabetes management'),
('Antihypertensive', 'Blood pressure medications'),
('Antihistamine', 'Allergy medications'),
('Vitamin/Supplement', 'Vitamins and dietary supplements'),
('Controlled', 'Schedule H/X controlled substances'),
('Other', 'Other medications');

-- Insert default suppliers
INSERT INTO suppliers (name, contact_person, phone, email, address, license_number) VALUES
('Sun Pharma', 'Rajesh Kumar', '+91-9876543210', 'contact@sunpharma.com', 'Mumbai, Maharashtra', 'MH-001'),
('Cipla', 'Priya Sharma', '+91-9807654321', 'info@cipla.com', 'Mumbai, Maharashtra', 'MH-002'),
("Dr. Reddy's", 'Arjun Patel', '+91-9765432109', 'sales@drreddys.com', 'Hyderabad, Telangana', 'TS-001'),
('Lupin', 'Meena Joshi', '+91-9654321098', 'contact@lupin.com', 'Pune, Maharashtra', 'MH-003'),
('Abbott India', 'Suresh Menon', '+91-9543210987', 'info@abbott.com', 'Mumbai, Maharashtra', 'MH-004'),
('Zydus', 'Kavita Reddy', '+91-9432109876', 'contact@zydus.com', 'Ahmedabad, Gujarat', 'GJ-001');

-- Insert sample drugs
INSERT INTO drugs (id, name, generic_name, hsn_code, schedule_type, category_id, dosage_form, batch_number, expiry_date, current_stock, reorder_level, purchase_price, mrp, gst_rate, supplier_id, notes) VALUES
('D001', 'Amoxicillin 500mg', 'Amoxicillin', '3004.20', 'Schedule H', 1, 'Capsule', 'BT-2025-014', '2026-08-15', 420, 100, 2.50, 4.80, 12.00, 2, 'Store below 25°C'),
('D002', 'Paracetamol 500mg', 'Paracetamol', '3004.90', 'OTC', 2, 'Tablet', 'BT-2025-022', '2027-03-10', 1200, 200, 0.80, 1.50, 5.00, 1, ''),
('D003', 'Alprazolam 0.5mg', 'Alprazolam', '3004.90', 'Schedule X', 8, 'Tablet', 'BT-2025-007', '2025-09-20', 45, 30, 5.20, 9.50, 12.00, 1, 'Psychotropic — dual record required'),
('D004', 'Metformin 500mg', 'Metformin HCl', '3004.90', 'Schedule H', 4, 'Tablet', 'BT-2024-098', '2025-07-31', 80, 100, 1.20, 2.20, 5.00, 3, ''),
('D005', 'Pantoprazole 40mg', 'Pantoprazole', '3004.90', 'Schedule H', 3, 'Tablet', 'BT-2025-031', '2026-11-25', 350, 80, 3.40, 6.20, 12.00, 5, ''),
('D006', 'Amlodipine 5mg', 'Amlodipine', '3004.90', 'Schedule H', 5, 'Tablet', 'BT-2025-016', '2027-01-15', 620, 150, 1.80, 3.20, 5.00, 4, ''),
('D007', 'Cetirizine 10mg', 'Cetirizine HCl', '3004.90', 'OTC', 6, 'Tablet', 'BT-2025-044', '2026-06-30', 28, 100, 0.90, 1.80, 5.00, 5, ''),
('D008', 'Azithromycin 250mg', 'Azithromycin', '3004.20', 'Schedule H1', 1, 'Tablet', 'BT-2025-009', '2025-10-08', 90, 60, 8.50, 15.00, 12.00, 2, 'Dual prescription copy retained'),
('D009', 'Vitamin D3 60K IU', 'Cholecalciferol', '3004.50', 'OTC', 7, 'Capsule', 'BT-2025-055', '2027-05-20', 310, 50, 12.00, 22.00, 5.00, 5, ''),
('D010', 'Atorvastatin 10mg', 'Atorvastatin', '3004.90', 'Schedule H', 5, 'Tablet', 'BT-2025-011', '2026-09-10', 0, 80, 2.10, 3.80, 5.00, 1, 'Out of stock — reorder placed'),
('D011', 'Ibuprofen 400mg', 'Ibuprofen', '3004.90', 'Schedule H', 2, 'Tablet', 'BT-2025-033', '2026-12-15', 540, 120, 1.10, 2.00, 5.00, 2, ''),
('D012', 'Ondansetron 4mg', 'Ondansetron HCl', '3004.90', 'Schedule H', 1, 'Tablet', 'BT-2025-018', '2025-08-22', 65, 40, 4.20, 7.50, 12.00, 5, 'Antiemetic');
