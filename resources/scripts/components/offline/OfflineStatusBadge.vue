<template>
  <div
    class="flex items-center px-2.5 py-1 text-xs font-medium rounded-full transition-all duration-300 shadow-xs cursor-pointer select-none"
    :class="badgeClass"
    :title="badgeTooltip"
    @click="triggerSync"
  >
    <span
      class="w-2 h-2 mr-1.5 rounded-full"
      :class="dotClass"
    ></span>
    <span>{{ badgeText }}</span>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import db from '@/scripts/services/offline/database'
import syncManager from '@/scripts/services/offline/syncManager'

const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
const pendingCount = ref(0)
const isSyncing = computed(() => syncManager.isSyncing)
let intervalId = null

async function updatePendingCount() {
  try {
    const count = await db.outbox.where('status').equals('pending').count()
    pendingCount.value = count
  } catch (e) {
    pendingCount.value = 0
  }
}

function handleOnline() {
  isOnline.value = true
  updatePendingCount()
}

function handleOffline() {
  isOnline.value = false
  updatePendingCount()
}

function triggerSync() {
  if (isOnline.value && !isSyncing.value) {
    syncManager.syncOutbox().then(() => updatePendingCount())
  }
}

onMounted(() => {
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  updatePendingCount()
  intervalId = setInterval(updatePendingCount, 3000)
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  if (intervalId) clearInterval(intervalId)
})

const badgeText = computed(() => {
  if (isSyncing.value) return 'Syncing...'
  if (!isOnline.value) {
    return pendingCount.value > 0
      ? `Offline (${pendingCount.value} pending)`
      : 'Offline'
  }
  return pendingCount.value > 0
    ? `Online (${pendingCount.value} unsynced)`
    : 'Online'
})

const badgeClass = computed(() => {
  if (isSyncing.value) {
    return 'bg-blue-100 text-blue-800 border border-blue-200'
  }
  if (!isOnline.value) {
    return 'bg-amber-100 text-amber-800 border border-amber-200'
  }
  if (pendingCount.value > 0) {
    return 'bg-yellow-100 text-yellow-800 border border-yellow-200'
  }
  return 'bg-emerald-100 text-emerald-800 border border-emerald-200'
})

const dotClass = computed(() => {
  if (isSyncing.value) return 'bg-blue-500 animate-pulse'
  if (!isOnline.value) return 'bg-amber-500'
  if (pendingCount.value > 0) return 'bg-yellow-500 animate-pulse'
  return 'bg-emerald-500'
})

const badgeTooltip = computed(() => {
  if (!isOnline.value) return 'You are offline. Changes will sync automatically when back online.'
  if (pendingCount.value > 0) return 'Click to force sync pending offline items'
  return 'Connected to backend server. All changes synced.'
})
</script>
