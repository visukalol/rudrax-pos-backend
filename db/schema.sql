-- =====================================================================
-- RudraX POS - POC Database Schema (PostgreSQL)
-- Covers: Sign-In/Employees, Departments/Items, Cash Register Sales,
--         Cash Drawer, Time Card, Customers
-- Run this once against a fresh database, e.g.:
--   psql -U postgres -d rudraxpos -f schema.sql
-- =====================================================================

CREATE TABLE stores (
    store_id        SERIAL PRIMARY KEY,
    store_name      VARCHAR(120) NOT NULL,
    address         VARCHAR(255),
    phone           VARCHAR(30),
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE registers (
    register_id     SERIAL PRIMARY KEY,
    store_id        INTEGER NOT NULL REFERENCES stores(store_id),
    register_no     VARCHAR(10) NOT NULL,
    device_name     VARCHAR(120),
    UNIQUE (store_id, register_no)
);

CREATE TABLE employees (
    employee_id     SERIAL PRIMARY KEY,
    store_id        INTEGER NOT NULL REFERENCES stores(store_id),
    full_name       VARCHAR(120) NOT NULL,
    pin_hash        VARCHAR(255) NOT NULL,      -- bcrypt hash of numeric PIN
    role            VARCHAR(20)  NOT NULL DEFAULT 'cashier', -- cashier / manager
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE time_card (
    time_card_id    SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(employee_id),
    register_id     INTEGER REFERENCES registers(register_id),
    clock_in        TIMESTAMP NOT NULL,
    clock_out       TIMESTAMP,
    is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE departments (
    department_id   SERIAL PRIMARY KEY,
    store_id        INTEGER NOT NULL REFERENCES stores(store_id),
    name            VARCHAR(120) NOT NULL,
    is_favourite    BOOLEAN NOT NULL DEFAULT FALSE,
    is_shortcut     BOOLEAN NOT NULL DEFAULT FALSE,
    surcharge_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
    tax_pct         NUMERIC(5,2) NOT NULL DEFAULT 0,
    age_restriction INTEGER,                     -- e.g. 21, null = none
    status          VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE categories (
    category_id     SERIAL PRIMARY KEY,
    department_id   INTEGER NOT NULL REFERENCES departments(department_id),
    name            VARCHAR(120) NOT NULL
);

CREATE TABLE items (
    item_id         SERIAL PRIMARY KEY,
    sku             VARCHAR(30) UNIQUE NOT NULL,
    department_id   INTEGER REFERENCES departments(department_id),
    category_id     INTEGER REFERENCES categories(category_id),
    name            VARCHAR(200) NOT NULL,
    size            VARCHAR(30),
    pack            VARCHAR(30),
    item_type       VARCHAR(20) NOT NULL DEFAULT 'Standard',
    unit_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
    retail_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
    card_price      NUMERIC(10,2),
    qty_on_hand     INTEGER NOT NULL DEFAULT 0,
    reorder_qty     INTEGER NOT NULL DEFAULT 0,
    is_taxable      BOOLEAN NOT NULL DEFAULT TRUE,
    is_age_restricted BOOLEAN NOT NULL DEFAULT FALSE,
    is_ebt          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE item_upc (
    upc_id          SERIAL PRIMARY KEY,
    item_id         INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    upc             VARCHAR(30) UNIQUE NOT NULL
);

CREATE TABLE customers (
    customer_id     SERIAL PRIMARY KEY,
    store_id        INTEGER NOT NULL REFERENCES stores(store_id),
    name            VARCHAR(120) NOT NULL,
    phone           VARCHAR(30),
    email           VARCHAR(120),
    credit_limit    NUMERIC(10,2) NOT NULL DEFAULT 0,
    balance         NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE sales_transactions (
    transaction_id      SERIAL PRIMARY KEY,
    pos_order_id         VARCHAR(60) UNIQUE NOT NULL,
    store_id             INTEGER NOT NULL REFERENCES stores(store_id),
    register_id           INTEGER NOT NULL REFERENCES registers(register_id),
    employee_id           INTEGER NOT NULL REFERENCES employees(employee_id),
    customer_id            INTEGER REFERENCES customers(customer_id),
    subtotal               NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_total               NUMERIC(10,2) NOT NULL DEFAULT 0,
    discount_total           NUMERIC(10,2) NOT NULL DEFAULT 0,
    grand_total               NUMERIC(10,2) NOT NULL DEFAULT 0,
    amount_tendered            NUMERIC(10,2) NOT NULL DEFAULT 0,
    change_due                  NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_type                  VARCHAR(20) NOT NULL DEFAULT 'CASH', -- CASH/CARD/EBT/CHECK/SPLIT
    status                          VARCHAR(20) NOT NULL DEFAULT 'COMPLETE', -- COMPLETE/VOID/RETURN/HELD
    created_at                      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE sales_transaction_items (
    line_id         SERIAL PRIMARY KEY,
    transaction_id  INTEGER NOT NULL REFERENCES sales_transactions(transaction_id) ON DELETE CASCADE,
    item_id         INTEGER REFERENCES items(item_id),
    sku             VARCHAR(30),
    item_name       VARCHAR(200) NOT NULL,
    qty             NUMERIC(10,3) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    line_total      NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE cash_drawer_log (
    log_id          SERIAL PRIMARY KEY,
    register_id     INTEGER NOT NULL REFERENCES registers(register_id),
    employee_id     INTEGER NOT NULL REFERENCES employees(employee_id),
    movement_type   VARCHAR(10) NOT NULL,  -- DROP / PAY_OUT / PAY_IN
    pay_by          VARCHAR(10),            -- CASH / CHECK
    reason          VARCHAR(200),
    distributor     VARCHAR(120),
    amount          NUMERIC(10,2) NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- =====================================================================
-- Seed data for local POC testing
-- =====================================================================
INSERT INTO stores (store_name, address, phone)
VALUES ('Ameristop Food Mart - 41071', '2114 Monmouth St, Newport, KY', '(859)-431-1636');

INSERT INTO registers (store_id, register_no, device_name)
VALUES (1, '01', 'POC-Register-1');

-- PIN 1234 for Rohit Patel (manager), PIN 1111 for Bob (cashier)
-- bcrypt hashes generated for '1234' and '1111'
INSERT INTO employees (store_id, full_name, pin_hash, role)
VALUES
 (1, 'Rohit Patel', '$2b$10$C9m6H1p0kQXwqk0K3s0e8.z6qF7hFqf1w8s9O1c3sY0dJdQeM8x9K', 'manager'),
 (1, 'Bob Patel',   '$2b$10$C9m6H1p0kQXwqk0K3s0e8.z6qF7hFqf1w8s9O1c3sY0dJdQeM8x9K', 'cashier');
-- NOTE: placeholder hashes above will NOT validate. Run backend/seed.js
-- once (see README) to insert real bcrypt hashes for PIN 1234 / 1111.

INSERT INTO departments (store_id, name, tax_pct, age_restriction)
VALUES
 (1, 'Grocery', 6.00, NULL),
 (1, 'Beer', 6.00, 21),
 (1, 'Vape', 6.00, 21),
 (1, 'Soda', 6.00, NULL),
 (1, 'Misc', 6.00, NULL);

INSERT INTO items (sku, department_id, name, size, unit_cost, retail_price, qty_on_hand, is_age_restricted)
VALUES
 ('50053', 3, 'Benson & Hedges 100', NULL, 10.00, 13.49, 100, TRUE),
 ('50632', 4, 'Mtn Dew Diet 20 Oz', '20 Oz', 1.20, 2.49, 200, FALSE),
 ('77734', 5, 'Doritos', NULL, 1.50, 2.79, 150, FALSE),
 ('50664', 2, 'Monster Green 16 Oz', '16 Oz', 1.80, 3.59, 120, FALSE);

INSERT INTO item_upc (item_id, upc) VALUES
 (1, '012300050053'),
 (2, '012300050632'),
 (3, '012300077734'),
 (4, '012300050664');
