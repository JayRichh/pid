<script setup lang="ts">
import '@components/motors/motor-calculator.js'
</script>

<template>
  <div class="motors-view">
    <h1>Motor / Prop Sizing</h1>
    <p class="subtitle">
      Estimate thrust, hover current, and efficiency for your FPV build. Select a motor and prop from
      the library or enter custom values.
    </p>
    <motor-calculator></motor-calculator>
  </div>
</template>

<style scoped>
.motors-view {
  max-width: 1400px;
  margin: 0 auto;
}
.subtitle {
  color: var(--fpv-text-muted);
  margin-bottom: var(--fpv-space-lg);
  font-size: var(--fpv-font-label);
}
</style>
