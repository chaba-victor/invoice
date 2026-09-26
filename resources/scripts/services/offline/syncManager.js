import axios from 'axios'
import db from './database'
import { useNotificationStore } from '@/scripts/stores/notification'

export class SyncManager {
  constructor() {
    this.isSyncing = false
  }

  init() {
    if (typeof window === 'undefined') return

    window.addEventListener('online', () => {
      console.log('Network status: ONLINE. Starting background sync...')
      this.syncOutbox()
    })

    window.addEventListener('offline', () => {
      console.log('Network status: OFFLINE. Operations will be queued locally.')
    })

    // Run initial sync and hydration if online
    if (navigator.onLine) {
      this.syncOutbox()
      this.hydrateReferenceData()
    }
  }

  async syncOutbox() {
    if (this.isSyncing || !navigator.onLine) return
    this.isSyncing = true

    try {
      const pendingItems = await db.outbox
        .where('status')
        .equals('pending')
        .sortBy('createdAt')

      if (pendingItems.length === 0) {
        this.isSyncing = false
        return
      }

      console.log(`Found ${pendingItems.length} pending offline operation(s) to sync.`)

      for (const item of pendingItems) {
        try {
          if (item.type === 'CREATE_INVOICE') {
            const response = await axios.post('/api/v1/invoices', item.payload)
            if (response && response.data && response.data.invoice) {
              const serverInvoice = response.data.invoice
              if (item.payload._localId) {
                await db.invoices.delete(item.payload._localId)
              }
              await db.invoices.put({
                ...serverInvoice,
                sync_status: 'synced',
              })
              await db.outbox.delete(item.id)
            }
          } else if (item.type === 'CREATE_CUSTOMER') {
            const response = await axios.post('/api/v1/customers', item.payload)
            if (response && response.data && response.data.data) {
              const serverCustomer = response.data.data
              if (item.payload._localId) {
                await db.customers.delete(item.payload._localId)
              }
              await db.customers.put({
                ...serverCustomer,
                sync_status: 'synced',
              })
              await db.outbox.delete(item.id)
            }
          } else if (item.type === 'CREATE_ITEM') {
            const response = await axios.post('/api/v1/items', item.payload)
            if (response && response.data && response.data.data) {
              const serverItem = response.data.data
              if (item.payload._localId) {
                await db.items.delete(item.payload._localId)
              }
              await db.items.put({
                ...serverItem,
                sync_status: 'synced',
              })
              await db.outbox.delete(item.id)
            }
          } else if (item.type === 'CREATE_ESTIMATE') {
            const response = await axios.post('/api/v1/estimates', item.payload)
            if (response && response.data && response.data.estimate) {
              const serverEstimate = response.data.estimate
              if (item.payload._localId) {
                await db.estimates.delete(item.payload._localId)
              }
              await db.estimates.put({
                ...serverEstimate,
                sync_status: 'synced',
              })
              await db.outbox.delete(item.id)
            }
          }
        } catch (err) {
          console.error(`Failed to sync outbox item #${item.id}:`, err)
        }
      }

      const notificationStore = useNotificationStore()
      if (notificationStore) {
        notificationStore.showNotification({
          type: 'success',
          message: 'All offline changes have been synchronized!',
        })
      }
    } catch (error) {
      console.error('Error during syncOutbox execution:', error)
    } finally {
      this.isSyncing = false
    }
  }

  async hydrateReferenceData() {
    if (!navigator.onLine) return
    try {
      const [customersRes, itemsRes] = await Promise.all([
        axios.get('/api/v1/customers?limit=100').catch(() => null),
        axios.get('/api/v1/items?limit=100').catch(() => null),
      ])

      if (customersRes && customersRes.data && customersRes.data.data) {
        await this.cacheCustomersLocally(customersRes.data.data)
      }
      if (itemsRes && itemsRes.data && itemsRes.data.data) {
        await this.cacheItemsLocally(itemsRes.data.data)
      }
      console.log('IndexedDB reference data hydrated successfully!')
    } catch (err) {
      console.warn('Reference data hydration failed:', err)
    }
  }

  async cacheInvoicesLocally(invoices) {
    if (!Array.isArray(invoices)) return
    try {
      const formatted = invoices.map((inv) => ({
        ...inv,
        sync_status: 'synced',
      }))
      await db.invoices.bulkPut(formatted)
    } catch (err) {
      console.warn('Failed to cache invoices in IndexedDB:', err)
    }
  }

  async cacheCustomersLocally(customers) {
    if (!Array.isArray(customers)) return
    try {
      const formatted = customers.map((c) => ({
        ...c,
        sync_status: 'synced',
      }))
      await db.customers.bulkPut(formatted)
    } catch (err) {
      console.warn('Failed to cache customers in IndexedDB:', err)
    }
  }

  async cacheItemsLocally(items) {
    if (!Array.isArray(items)) return
    try {
      const formatted = items.map((i) => ({
        ...i,
        sync_status: 'synced',
      }))
      await db.items.bulkPut(formatted)
    } catch (err) {
      console.warn('Failed to cache items in IndexedDB:', err)
    }
  }
}

export const syncManager = new SyncManager()
export default syncManager
