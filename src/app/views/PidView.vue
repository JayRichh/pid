<script setup lang="ts">
import '@components/pid/pid-simulator.js'
</script>

<template>
  <div class="pid-view">
    <h1>PID Simulator</h1>
    <p class="subtitle">Interactive Betaflight-style rate-loop simulator. Adjust gains and see the response in real-time.</p>
    <pid-simulator></pid-simulator>
  </div>
</template>

<style scoped>
.pid-view { max-width: 1400px; margin: 0 auto; }
.subtitle { color: var(--fpv-text-muted); margin-bottom: var(--fpv-space-lg); font-size: var(--fpv-font-label); }
</style>
