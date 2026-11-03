<template>
  <div class="flex flex-col items-center justify-between w-full pt-10">
    <MainLogo class="block w-48 h-auto mb-5 md:mb-10 text-primary-500" />

    <BaseWizard
      :steps="wizardSteps"
      :current-step="wizardCurrentStep"
      @click="onNavClick"
    >
      <component :is="stepComponent" @next="onStepChange" />
    </BaseWizard>
  </div>
</template>

<script>
import { computed, ref } from 'vue'
import Step1RequirementsCheck from './Step1RequirementsCheck.vue'
import Step2PermissionCheck from './Step2PermissionCheck.vue'
import Step3DatabaseConfig from './Step3DatabaseConfig.vue'
import Step4VerifyDomain from './Step4VerifyDomain.vue'
import Step5EmailConfig from './Step5EmailConfig.vue'
import Step6AccountSettings from './Step6AccountSettings.vue'
import Step7CompanyInfo from './Step7CompanyInfo.vue'
import Step8CompanyPreferences from './Step8CompanyPreferences.vue'
import MainLogo from '@/scripts/components/icons/MainLogo.vue'
import { useInstallationStore } from '@/scripts/admin/stores/installation'
import { useRouter } from 'vue-router'
import { isDesktopApp } from '@/scripts/helpers/app-mode'

export default {
  components: {
    MainLogo,
    step_1: Step1RequirementsCheck,
    step_2: Step2PermissionCheck,
    step_3: Step3DatabaseConfig,
    step_4: Step4VerifyDomain,
    step_5: Step5EmailConfig,
    step_6: Step6AccountSettings,
    step_7: Step7CompanyInfo,
    step_8: Step8CompanyPreferences,
  },

  setup() {
    let stepComponent = ref('step_1')
    let currentStepNumber = ref(1)

    const router = useRouter()
    const installationStore = useInstallationStore()

    // The desktop app completes the server steps (1-5) itself, so its progress shows steps 6-8 only.
    const isDesktop = isDesktopApp()
    const wizardSteps = isDesktop ? 3 : 7
    const wizardCurrentStep = computed(() =>
      isDesktop ? currentStepNumber.value - 5 : currentStepNumber.value
    )

    checkCurrentProgress()

    async function checkCurrentProgress() {
      let res = await installationStore.fetchInstallationStep()

      if (res.data.profile_complete === 'COMPLETED') {
        router.push('/admin/dashboard')
        return
      }

      let dbstep = parseInt(res.data.profile_complete)

      // Steps 6 onwards edit the signed-in user. Step 4 normally signs in, so resuming past it
      // (a closed browser, or the desktop app, which completes steps 1-5 itself) needs a session.
      if (dbstep >= 5) {
        await ensureInstallationSession()
      }

      if (dbstep) {
        currentStepNumber.value = dbstep + 1
        stepComponent.value = `step_${dbstep + 1}`
      }
    }

    async function ensureInstallationSession() {
      try {
        await installationStore.checkAutheticated()
      } catch (e) {
        await installationStore.installationLogin()
      }
    }

    async function saveStepProgress(data) {
      let status = {
        profile_complete: data,
      }

      try {
        await installationStore.addInstallationStep(status)
        return true
      } catch (e) {
        if (e?.response?.data?.message === 'The MAC is invalid.') {
          window.location.reload()
        }
        return false
      }
    }

    async function onStepChange(data) {
      if (data) {
        let res = await saveStepProgress(data)
        if (!res) return false
      }

      currentStepNumber.value++

      if (currentStepNumber.value <= 8) {
        stepComponent.value = 'step_' + currentStepNumber.value
      }
    }

    function onNavClick(e) {}

    return {
      stepComponent,
      currentStepNumber,
      wizardSteps,
      wizardCurrentStep,
      onStepChange,
      saveStepProgress,
      onNavClick,
    }
  },
}
</script>
