<template>
  <div class="mt-6 mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg text-center">
    <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Choose Application Platform</p>
    <div class="grid grid-cols-2 gap-2">
      <button
        type="button"
        class="flex flex-col items-center justify-center p-3 bg-white border border-primary-300 hover:border-primary-500 rounded-md shadow-xs transition-all duration-200 group"
        @click="installPWA"
      >
        <span class="text-lg mb-1">🌐</span>
        <span class="text-xs font-semibold text-gray-800 group-hover:text-primary-600">Web App / PWA</span>
        <span class="text-[10px] text-gray-500">Run in Browser</span>
      </button>

      <a
        href="https://github.com/your-username/invoice/releases"
        target="_blank"
        class="flex flex-col items-center justify-center p-3 bg-white border border-gray-200 hover:border-gray-400 rounded-md shadow-xs transition-all duration-200 group no-underline"
      >
        <span class="text-lg mb-1">🖥️</span>
        <span class="text-xs font-semibold text-gray-800 group-hover:text-primary-600">Desktop App</span>
        <span class="text-[10px] text-gray-500">Download .exe / .dmg</span>
      </a>
    </div>
  </div>

  <div class="mt-4 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-left text-xs text-blue-900">
    <div class="flex items-center justify-between mb-1">
      <span class="font-semibold">Default Admin Credentials:</span>
      <button
        type="button"
        class="text-[11px] bg-blue-600 hover:bg-blue-700 text-white font-medium px-2.5 py-1 rounded transition-colors"
        @click="fillDemoCredentials"
      >
        Auto-Fill Credentials
      </button>
    </div>
    <p class="mt-1">Email: <code class="bg-blue-100 px-1 py-0.5 rounded font-mono">admin@craterapp.com</code></p>
    <p class="mt-0.5">Password: <code class="bg-blue-100 px-1 py-0.5 rounded font-mono">crater@123</code></p>
  </div>

  <form id="loginForm" class="mt-6 text-left" @submit.prevent="onSubmit">
    <BaseInputGroup
      :error="v$.email.$error && v$.email.$errors[0].$message"
      :label="$t('login.email')"
      class="mb-4"
      required
    >
      <BaseInput
        v-model="authStore.loginData.email"
        :invalid="v$.email.$error"
        focus
        type="email"
        name="email"
        @input="v$.email.$touch()"
      />
    </BaseInputGroup>

    <BaseInputGroup
      :error="v$.password.$error && v$.password.$errors[0].$message"
      :label="$t('login.password')"
      class="mb-4"
      required
    >
      <BaseInput
        v-model="authStore.loginData.password"
        :invalid="v$.password.$error"
        :type="getInputType"
        name="password"
        @input="v$.password.$touch()"
      >
        <template #right>
          <BaseIcon
            v-if="isShowPassword"
            name="EyeOffIcon"
            class="w-5 h-5 mr-1 text-gray-500 cursor-pointer"
            @click="isShowPassword = !isShowPassword"
          />
          <BaseIcon
            v-else
            name="EyeIcon"
            class="w-5 h-5 mr-1 text-gray-500 cursor-pointer"
            @click="isShowPassword = !isShowPassword"
          /> </template
      ></BaseInput>
    </BaseInputGroup>

    <div class="mt-5 mb-8">
      <div class="mb-4">
        <router-link
          to="forgot-password"
          class="text-sm text-primary-400 hover:text-gray-700"
        >
          {{ $t('login.forgot_password') }}
        </router-link>
      </div>
    </div>
    <BaseButton :loading="isLoading" type="submit">
      {{ $t('login.login') }}
    </BaseButton>
  </form>
</template>

<script setup>
import axios from 'axios'
import { ref, computed } from 'vue'
import { useNotificationStore } from '@/scripts/stores/notification'
import { useRouter } from 'vue-router'
import { required, email, helpers } from '@vuelidate/validators'
import { useVuelidate } from '@vuelidate/core'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/scripts/admin/stores/auth'
import { handleError } from '@/scripts/helpers/error-handling'

const notificationStore = useNotificationStore()
const authStore = useAuthStore()
const { t } = useI18n()
const router = useRouter()
const isLoading = ref(false)
let isShowPassword = ref(false)
const deferredPrompt = ref(null)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e
  })
}

function installPWA() {
  if (deferredPrompt.value) {
    deferredPrompt.value.prompt()
    deferredPrompt.value.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        notificationStore.showNotification({
          type: 'success',
          message: 'PWA Installed successfully!',
        })
      }
      deferredPrompt.value = null
    })
  } else {
    notificationStore.showNotification({
      type: 'info',
      message: 'To install the PWA, click the Install icon in your browser address bar!',
    })
  }
}

function fillDemoCredentials() {
  authStore.loginData.email = 'admin@craterapp.com'
  authStore.loginData.password = 'crater@123'
}

const rules = {
  email: {
    required: helpers.withMessage(t('validation.required'), required),
    email: helpers.withMessage(t('validation.email_incorrect'), email),
  },
  password: {
    required: helpers.withMessage(t('validation.required'), required),
  },
}

const v$ = useVuelidate(
  rules,
  computed(() => authStore.loginData)
)

const getInputType = computed(() => {
  if (isShowPassword.value) {
    return 'text'
  }
  return 'password'
})

async function onSubmit() {
  axios.defaults.withCredentials = true

  v$.value.$touch()

  if (v$.value.$invalid) {
    return true
  }

  isLoading.value = true

  try {
    isLoading.value = true
    await authStore.login(authStore.loginData)

    router.push('/admin/dashboard')

    notificationStore.showNotification({
      type: 'success',
      message: 'Logged in successfully.',
    })
  } catch (error) {
    isLoading.value = false
  }
}
</script>
