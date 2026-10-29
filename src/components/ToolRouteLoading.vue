<template>
  <div class="tool-route-loading" role="status" aria-live="polite">
    <span class="tool-route-loading__bar" />
  </div>
</template>

<style scoped>
.tool-route-loading {
  min-height: 220px;
  display: grid;
  place-items: center;
}

.tool-route-loading__bar {
  width: 88px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary-color, #18a058) 20%, transparent);
  position: relative;
}

.tool-route-loading__bar::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  border-radius: inherit;
  background: var(--primary-color, #18a058);
  animation: tool-route-loading 900ms ease-in-out infinite;
}

@keyframes tool-route-loading {
  0% { transform: translateX(-100%); }
  50%, 100% { transform: translateX(250%); }
}

@media (prefers-reduced-motion: reduce) {
  .tool-route-loading__bar::after { animation: none; }
}
</style>
