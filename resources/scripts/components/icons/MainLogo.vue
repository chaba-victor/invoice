<template>
  <svg viewBox="0 0 160 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g class="items-center">
      <!-- Icon symbol -->
      <rect x="2" y="4" width="32" height="32" rx="8" fill="url(#mainlogo_grad)" />
      <path d="M12 13H24M12 18H24M12 23H18M12 28H21" stroke="white" stroke-width="2.5" stroke-linecap="round" />
      <!-- Text -->
      <text x="44" y="29" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="25" font-weight="800" letter-spacing="-0.5px" fill="currentColor">invoice</text>
    </g>
    <defs>
      <linearGradient id="mainlogo_grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop :stop-color="darkColor" />
        <stop offset="1" :stop-color="lightColor" />
      </linearGradient>
    </defs>
  </svg>
</template>

<script setup>
defineProps({
  darkColor: {
    type: String,
    default: 'rgba(var(--color-primary-500), var(--tw-text-opacity, 1))',
  },
  lightColor: {
    type: String,
    default: 'rgba(var(--color-primary-400), var(--tw-text-opacity, 1))',
  },
})
</script>
