import Dexie from 'dexie'

export const db = new Dexie('InvoiceOfflineDB')

db.version(1).stores({
  invoices: '++id, invoice_number, customer_id, sync_status, created_at',
  estimates: '++id, estimate_number, customer_id, sync_status, created_at',
  customers: '++id, name, email',
  items: '++id, name, price',
  outbox: '++id, type, payload, createdAt, status',
})

export default db
