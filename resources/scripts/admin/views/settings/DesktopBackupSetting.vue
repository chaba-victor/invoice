<template>
  <BaseSettingCard
    :title="$t('settings.desktop_backup.title')"
    :description="$t('settings.desktop_backup.description')"
  >
    <div class="mt-8">
      <h6 class="text-lg font-semibold text-left">
        {{ $t('settings.desktop_backup.backup_heading') }}
      </h6>
      <p class="mt-1 text-sm text-gray-500">
        {{ $t('settings.desktop_backup.backup_help') }}
      </p>
      <p class="mt-3 text-sm text-gray-700">
        {{ lastBackupText }}
      </p>
      <BaseButton
        class="mt-4"
        variant="primary"
        :loading="isBackingUp"
        :disabled="isBusy"
        @click="onBackup"
      >
        <template #left="slotProps">
          <BaseIcon :class="slotProps.class" name="DownloadIcon" />
        </template>
        {{ $t('settings.desktop_backup.backup_now') }}
      </BaseButton>
    </div>

    <BaseDivider class="my-8" />

    <div>
      <h6 class="text-lg font-semibold text-left">
        {{ $t('settings.desktop_backup.restore_heading') }}
      </h6>
      <p class="mt-1 text-sm text-gray-500">
        {{ $t('settings.desktop_backup.restore_help') }}
      </p>
      <BaseButton
        class="mt-4"
        variant="primary-outline"
        :loading="isRestoring"
        :disabled="isBusy"
        @click="onRestore"
      >
        <template #left="slotProps">
          <BaseIcon :class="slotProps.class" name="UploadIcon" />
        </template>
        {{ $t('settings.desktop_backup.restore') }}
      </BaseButton>
    </div>

    <BaseDivider class="my-8" />

    <div>
      <h6 class="text-lg font-semibold text-left">
        {{ $t('settings.desktop_backup.automatic_heading') }}
      </h6>
      <p class="mt-1 text-sm text-gray-500">
        {{ $t('settings.desktop_backup.automatic_help') }}
      </p>
      <p v-if="info.lastAutoBackupAt" class="mt-3 text-sm text-gray-700">
        {{
          $t('settings.desktop_backup.last_automatic', {
            date: formatDate(info.lastAutoBackupAt),
          })
        }}
      </p>
      <BaseButton class="mt-4" variant="white" @click="onOpenFolder">
        <template #left="slotProps">
          <BaseIcon :class="slotProps.class" name="FolderOpenIcon" />
        </template>
        {{ $t('settings.desktop_backup.open_folder') }}
      </BaseButton>
    </div>
  </BaseSettingCard>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '@/scripts/stores/notification'

// Provided by the desktop app's preload script (desktop/preload.js); the dialogs and file
// handling run in the desktop app itself.
const desktop = window.invoiceDesktop

const { t } = useI18n()
const notificationStore = useNotificationStore()

const info = ref({ lastBackupAt: null, lastAutoBackupAt: null })
const isBackingUp = ref(false)
const isRestoring = ref(false)

const isBusy = computed(() => isBackingUp.value || isRestoring.value)

const lastBackupText = computed(() =>
  info.value.lastBackupAt
    ? t('settings.desktop_backup.last_backup', {
        date: formatDate(info.value.lastBackupAt),
      })
    : t('settings.desktop_backup.never_backed_up')
)

onMounted(loadInfo)

async function loadInfo() {
  if (desktop) {
    info.value = await desktop.getBackupInfo()
  }
}

function formatDate(value) {
  return new Date(value).toLocaleString()
}

async function onBackup() {
  isBackingUp.value = true

  try {
    const result = await desktop.createBackup()

    if (result.ok) {
      notificationStore.showNotification({
        type: 'success',
        message: t('settings.desktop_backup.backup_saved', { path: result.path }),
      })
      await loadInfo()
    } else if (!result.canceled) {
      notificationStore.showNotification({
        type: 'error',
        message: result.error,
      })
    }
  } finally {
    isBackingUp.value = false
  }
}

async function onRestore() {
  isRestoring.value = true

  try {
    // The desktop app asks for the file, confirms, restores and reloads the app.
    await desktop.restoreBackup()
  } finally {
    isRestoring.value = false
  }
}

function onOpenFolder() {
  desktop.openBackupsFolder()
}
</script>
